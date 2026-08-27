import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { parseDomain } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { pickNextTask, tasksFor, toPublic } from "@/lib/tasks";
import { nextDifficultyFor, subskillsOf } from "@/lib/profile";

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

  const [history, targetDifficulty, profile] = await Promise.all([
    prisma.learningEvent.findMany({
      where: { userId, domain },
      select: { taskId: true, success: true, createdAt: true },
    }),
    nextDifficultyFor(userId, domain),
    prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } }, select: { subskills: true } }),
  ]);

  // Leader / 寸評は「いちばん弱い観点」を勧めるので、未回答の課題の中でその観点を含むものを優先する
  // （推薦文と実際に出る課題が食い違わないようにする。決定論）
  let chosen = preferred;
  if (!chosen) {
    const weakest = weakestSubskill(subskillsOf(profile?.subskills ?? {}));
    if (weakest) {
      const seen = new Set(history.map((h) => h.taskId));
      const candidates = tasksFor(domain)
        .filter((t) => !seen.has(t.id) && t.skillTags.includes(weakest))
        .sort((a, b) => Math.abs(a.difficulty - targetDifficulty) - Math.abs(b.difficulty - targetDifficulty));
      chosen = candidates[0]?.id;
    }
  }

  const task = pickNextTask(domain, targetDifficulty, history, chosen);
  return NextResponse.json({ task: toPublic(task), targetDifficulty });
}

function weakestSubskill(subskills: Record<string, number>): string | null {
  const entries = Object.entries(subskills);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => a[1] - b[1])[0][0];
}
