import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { buildAgentContext } from "@/lib/agent-context";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/http";
import { PERSONA_DEFAULTS, TONE_PRESETS } from "@/config/trivium.config";
import { AI_SYSTEM_POLICY } from "@/lib/ai/types";

export const dynamic = "force-dynamic";

// GET /api/agent/context?ref=<userId>
//   Dify の Chatflow（4 人格 + 教材おすすめ）が「人格・能力値・直近の履歴・出題中の課題」を 1 回で読むための
//   サーバ間 API。Cookie ではなく Bearer トークン（TRIVIUM_AGENT_TOKEN）で認証する。
//   ブラウザからは呼ばせない前提なので rejectCrossSite は使わない（Origin が付かない）。

/** 長さの違いを漏らさないよう、SHA-256 の固定長ダイジェストで比較する */
function tokenMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** 学習者が見つからないときの最小コンテキスト（Dify から呼ばれても止まらないように 200 で返す） */
function notFoundContext(ref: string) {
  return {
    found: false,
    learner: { ref, displayName: "あなた" },
    personas: Object.fromEntries(
      (["READ", "WRITE", "CODE", "LEADER"] as const).map((k) => [
        k,
        { name: PERSONA_DEFAULTS[k].name, tone: PERSONA_DEFAULTS[k].tone, toneDescription: TONE_PRESETS[PERSONA_DEFAULTS[k].tone as keyof typeof TONE_PRESETS] ?? "", firstPerson: PERSONA_DEFAULTS[k].firstPerson, extra: PERSONA_DEFAULTS[k].extra },
      ]),
    ),
    profile: {},
    recommendedDomain: null,
    recommendedDifficulty: 2,
    xp: { total: 0, rank: "", streak: 0, missionToday: false },
    recentEvents: [],
    currentTask: null,
    recentChat: [],
    materialsSeen: [],
    policy: AI_SYSTEM_POLICY,
  };
}

export async function GET(req: Request) {
  const expected = env.agentApiToken;
  if (!expected) {
    return NextResponse.json({ error: "agent api is not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!given || !tokenMatches(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ref = new URL(req.url).searchParams.get("ref")?.trim() ?? "";
  if (!ref) return NextResponse.json({ error: "ref is required" }, { status: 400 });

  const limited = rateLimit(`agent-context:${ref}`, 60, 600_000);
  if (limited) return limited;

  const context = await buildAgentContext(ref);
  // 見つからないときも 200 で返す（Dify の HTTP ノードは非 2xx でワークフローを止めるため）。
  // found:false と既定の人格・ポリシーだけを返し、会話は文脈なしで続けられるようにする。
  if (!context) return NextResponse.json(notFoundContext(ref), { status: 200 });
  console.log(`[agent] context ref=${ref.slice(-6)} ok`);
  return NextResponse.json(context);
}
