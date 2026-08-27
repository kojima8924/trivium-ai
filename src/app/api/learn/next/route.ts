import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { parseDomain } from "@/lib/domain";
import { nextTask } from "@/lib/learn/service";
import { toPublic } from "@/lib/tasks";

export const dynamic = "force-dynamic";

// GET /api/learn/next?domain=code[&task=code-003]
// 次のタスクを返す（answerKey / hints / explanation は含めない）。実体は src/lib/learn/service.ts
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const domain = parseDomain(url.searchParams.get("domain"));
  if (!domain) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  const preferred = url.searchParams.get("task") ?? undefined;

  const { task, targetDifficulty } = await nextTask(userId, domain, { preferredTaskId: preferred });
  return NextResponse.json({ task: toPublic(task), targetDifficulty });
}
