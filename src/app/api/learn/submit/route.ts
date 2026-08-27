import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/auth";
import { MAX_HINTS } from "@/lib/domain";
import { rateLimit, rejectCrossSite } from "@/lib/http";
import { submitAnswer } from "@/lib/learn/service";
import { notifyDailyDigestIfComplete } from "@/lib/learn/digest";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  taskId: z.string().min(1),
  answer: z.string().max(4000),
  /** クライアントの表示用。スコアの根拠には使わない（サーバの TaskAttempt が正本） */
  hintCount: z.number().int().min(0).max(MAX_HINTS).optional(),
  /** 回答開始からの経過ms（任意） */
  latencyMs: z.number().int().min(0).optional(),
  /** ギブアップ（失敗として記録し解説を見る） */
  giveUp: z.boolean().optional(),
});

// POST /api/learn/submit
// 1) 決定論的採点 → 2) AI が feedback / 一段ヒント → 3) 決着時のみ learning_event を記録 → 4) profile 再計算
// 実体は src/lib/learn/service.ts（LINE webhook と共通）
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 1問あたり最大4回（誤答3＋正答）なので、通常利用では当たらない上限にする
  const limited = rateLimit(`submit:${userId}`, 40, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { taskId, answer, latencyMs, giveUp } = parsed.data;

  const result = await submitAnswer(userId, taskId, { answer, latencyMs, giveUp });
  if ("error" in result) return NextResponse.json({ error: "unknown task" }, { status: 404 });
  // 「今日の3問」が揃えば LINE に総評を push（finalize の後に呼ぶ。DailyDigest の unique で冪等）
  if (result.status !== "retry" && !result.practice) await notifyDailyDigestIfComplete(userId).catch(() => undefined);
  return NextResponse.json(result);
}
