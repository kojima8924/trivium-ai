import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { buildAgentContext } from "@/lib/agent-context";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/http";

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
  if (!context) return NextResponse.json({ error: "learner not found" }, { status: 404 });
  console.log(`[agent] context ref=${ref.slice(-6)} ok`);
  return NextResponse.json(context);
}
