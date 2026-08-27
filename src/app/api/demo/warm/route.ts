import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { env } from "@/lib/env";
import { rateLimit, rejectCrossSite } from "@/lib/http";
import { warmFeedbackCache } from "@/lib/learn/service";
import { ALL_TASKS } from "@/lib/tasks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/demo/warm  { levels?: number[] }
// 選択式の講評キャッシュをログイン中ユーザーの人格で事前生成する（デモ前・LINE の即答用）。
// LLM を最大 (choice タスク数 × 4 × levels) 回呼ぶので、レート制限を厳しめにする。
export async function POST(req: Request) {
  if (!env.demoSeedEnabled) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limited = rateLimit(`warm:${userId}`, 2, 10 * 60_000);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { levels?: unknown };
  const levels = Array.isArray(body.levels)
    ? body.levels.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 3)
    : [0];
  const ids = ALL_TASKS.filter((t) => t.kind === "choice").map((t) => t.id);
  const started = Date.now();
  const processed = await warmFeedbackCache(userId, ids, { hintLevels: levels.length ? levels : [0], concurrency: 4 });
  return NextResponse.json({ ok: true, processed, tasks: ids.length, levels, seconds: Math.round((Date.now() - started) / 1000) });
}
