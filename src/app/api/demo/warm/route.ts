import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { rateLimit, rejectCrossSite } from "@/lib/http";
import { warmFeedbackCache } from "@/lib/learn/service";
import { ALL_TASKS } from "@/lib/tasks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 1 リクエストで温める課題数の上限（LLM 呼び出しは 課題数 × 4 択 × 1 段）
const MAX_TASKS_PER_CALL = 20;
// プロセス内で同時に走る warm は 1 本だけ（多重起動で LLM を並列消費させない）
let running = false;

// POST /api/demo/warm  { levels?: number[]; offset?: number; limit?: number }
// 選択式の講評キャッシュをログイン中ユーザーの人格で事前生成する（デモ前・LINE の即答用）。
// 管理者（ADMIN_EMAILS）専用。1 回あたり最大 20 課題・ヒント段階 1 つに制限し、
// 続きは返却される next を offset に渡して呼ぶ（全件は `npm run warm-cache` でも可）。
export async function POST(req: Request) {
  if (!env.demoSeedEnabled) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const email = (session?.user?.email ?? "").toLowerCase();
  if (!email || !env.adminEmails.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const limited = rateLimit(`warm:${userId}`, 6, 10 * 60_000);
  if (limited) return limited;
  if (running) return NextResponse.json({ error: "busy" }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { levels?: unknown; offset?: unknown; limit?: unknown };
  const level = Array.isArray(body.levels) ? body.levels.find((n): n is number => Number.isInteger(n) && n >= 0 && n <= 3) : undefined;
  const offset = Number.isInteger(body.offset) && (body.offset as number) >= 0 ? (body.offset as number) : 0;
  const limit = Number.isInteger(body.limit) && (body.limit as number) > 0 ? Math.min(body.limit as number, MAX_TASKS_PER_CALL) : MAX_TASKS_PER_CALL;
  const all = ALL_TASKS.filter((t) => t.kind === "choice").map((t) => t.id);
  const ids = all.slice(offset, offset + limit);
  const started = Date.now();
  running = true;
  try {
    const processed = await warmFeedbackCache(userId, ids, { hintLevels: [level ?? 0], concurrency: 2 });
    const next = offset + ids.length < all.length ? offset + ids.length : null;
    return NextResponse.json({ ok: true, processed, tasks: ids.length, total: all.length, next, level: level ?? 0, seconds: Math.round((Date.now() - started) / 1000) });
  } finally {
    running = false;
  }
}
