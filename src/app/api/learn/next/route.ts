import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { parseDomain } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { pickNextTask, toPublic } from "@/lib/tasks";
import { nextDifficultyFor } from "@/lib/profile";

export const dynamic = "force-dynamic";

// GET /api/learn/next?domain=code[&task=code-003]
// 次のタスクを返す（answerKey / hints / explanation は含めない）
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const domain = parseDomain(url.searchParams.get("domain"));
  if (!domain) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  const preferred = url.searchParams.get("task") ?? undefined;

  const [history, targetDifficulty] = await Promise.all([
    prisma.learningEvent.findMany({
      where: { userId, domain },
      select: { taskId: true, success: true, createdAt: true },
    }),
    nextDifficultyFor(userId, domain),
  ]);
  const task = pickNextTask(domain, targetDifficulty, history, preferred);
  return NextResponse.json({ task: toPublic(task), targetDifficulty });
}
