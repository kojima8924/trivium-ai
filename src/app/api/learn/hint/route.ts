import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/auth";
import { rateLimit, rejectCrossSite } from "@/lib/http";
import { requestHint } from "@/lib/learn/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ taskId: z.string().min(1) });

// POST /api/learn/hint
// 回答せずにヒントだけを 1 段もらう（Web の「💡 ヒント」ボタン）。LINE の「ヒント」と同じ経路（requestHint）。
// 回数はサーバの TaskAttempt が持ち、あとで正解したときの XP 倍率と証拠の重みに効く。使い切っていれば hint は null。
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 1 問あたり最大 3 回なので、通常利用では当たらない上限
  const limited = rateLimit(`hint:${userId}`, 30, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const result = await requestHint(userId, parsed.data.taskId);
  if (!result) return NextResponse.json({ error: "unknown task" }, { status: 404 });
  return NextResponse.json(result);
}
