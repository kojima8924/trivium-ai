import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/auth";
import { learningAI } from "@/lib/ai";
import { MAX_HINTS, type DomainKey } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { checkDeterministic, checkHeuristic, getTask } from "@/lib/tasks";
import { recomputeAll, subskillsOf } from "@/lib/profile";
import { evaluateAchievements } from "@/lib/achievements";
import { rateLimit, rejectCrossSite } from "@/lib/http";

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

const MODE: Record<DomainKey, "read" | "write" | "code"> = { READ: "read", WRITE: "write", CODE: "code" };

// POST /api/learn/submit
// 1) 決定論的採点 → 2) AI が feedback / 一段ヒント → 3) 決着時のみ learning_event を記録 → 4) profile 再計算
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

  const task = getTask(taskId);
  if (!task) return NextResponse.json({ error: "unknown task" }, { status: 404 });

  // ヒント回数はサーバが持つ TaskAttempt が正本（クライアントの申告は信用しない）。
  // 6時間以上放置された挑戦は新しい挑戦として扱う。
  const attempt = await prisma.taskAttempt.findUnique({ where: { userId_taskId: { userId, taskId } } });
  const stale = attempt ? Date.now() - attempt.updatedAt.getTime() > 6 * 60 * 60 * 1000 : false;
  const hintCount = attempt && !stale ? Math.min(attempt.hintCount, MAX_HINTS) : 0;

  const profile = await prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain: task.domain } } });
  const recent = await prisma.learningEvent.findMany({
    where: { userId, domain: task.domain },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { taskId: true, success: true, hintCount: true, difficulty: true },
  });

  // ギブアップ: 失敗として決着
  if (giveUp) {
    const event = await record(userId, task.domain, task.id, task.difficulty, answer, false, hintCount, latencyMs, task.skillTags);
    const after = await finalize(userId, task.domain);
    return NextResponse.json({
      status: "failed",
      feedback: "今回はここまでにしましょう。解説を読んで、次に同じ形の問題に出会ったときの足がかりにしてください。",
      hint: "",
      explanation: task.explanation,
      hintCount,
      event: { id: event.id },
      ...after,
    });
  }

  // 1) 決定論的採点（free は null）。free タスクはルーブリックのヒューリスティック判定を AI の参考情報として渡す
  const deterministic = checkDeterministic(task, answer);
  const heuristic = deterministic === null ? checkHeuristic(task, answer).pass : null;

  // 2) AI（Dify / Mock）による feedback と一段ヒント
  const ai = await learningAI.evaluate({
    mode: MODE[task.domain],
    learnerRef: userId,
    task: {
      id: task.id,
      title: task.title,
      passage: task.passage,
      prompt: task.prompt,
      kind: task.kind,
      choices: task.choices,
      difficulty: task.difficulty,
      criteria: task.rubric?.criteria,
      hints: task.hints,
    },
    learnerAnswer: answer,
    deterministicResult: deterministic,
    heuristicResult: heuristic,
    hintLevel: hintCount,
    currentDomainProfile: {
      score: profile?.score ?? 0,
      subskills: subskillsOf(profile?.subskills ?? {}),
      confidence: (profile?.confidence as "low" | "medium" | "high") ?? "low",
      evidenceCount: profile?.evidenceCount ?? 0,
      summary: profile?.summary ?? "",
    },
    recentBehavior: recent.map(
      (r) => `${r.taskId}: ${r.success ? "success" : "failure"} (hints=${r.hintCount}, difficulty=${r.difficulty})`,
    ),
  });

  const success = ai.status === "success";
  const skillTags = Array.from(new Set([...task.skillTags, ...ai.skillTags.filter((t) => task.skillTags.includes(t))]));

  // 3) 成功 → 決着。誤答でヒント上限に達した → 失敗として決着。それ以外はヒントを返して継続。
  if (success) {
    const event = await record(userId, task.domain, task.id, task.difficulty, answer, true, hintCount, latencyMs, skillTags);
    const after = await finalize(userId, task.domain);
    return NextResponse.json({
      status: "success",
      feedback: ai.feedback,
      hint: "",
      explanation: task.explanation,
      hintCount,
      observations: ai.observations,
      event: { id: event.id },
      ...after,
    });
  }

  const nextHintCount = hintCount + 1;
  await prisma.taskAttempt.upsert({
    where: { userId_taskId: { userId, taskId } },
    update: { hintCount: nextHintCount },
    create: { userId, taskId, hintCount: nextHintCount },
  });
  if (nextHintCount >= MAX_HINTS + 1) {
    const event = await record(userId, task.domain, task.id, task.difficulty, answer, false, hintCount, latencyMs, skillTags);
    const after = await finalize(userId, task.domain);
    return NextResponse.json({
      status: "failed",
      feedback: "ヒントを使い切りました。解説を読んで、次に同じ形の問題に出会ったときの足がかりにしてください。",
      hint: "",
      explanation: task.explanation,
      hintCount,
      event: { id: event.id },
      ...after,
    });
  }

  return NextResponse.json({
    status: "retry",
    feedback: ai.feedback,
    hint: ai.hint,
    hintCount: nextHintCount,
    hintsRemaining: MAX_HINTS - nextHintCount,
  });
}

/** 決着した挑戦の進行状態を削除する */
async function clearAttempt(userId: string, taskId: string) {
  await prisma.taskAttempt.deleteMany({ where: { userId, taskId } });
}

async function record(
  userId: string,
  domain: DomainKey,
  taskId: string,
  difficulty: number,
  answer: string,
  success: boolean,
  hintCount: number,
  latencyMs: number | undefined,
  skillTags: string[],
) {
  const event = await prisma.learningEvent.create({
    data: { userId, domain, taskId, difficulty, answer: answer.slice(0, 4000), success, hintCount, latencyMs, skillTags },
  });
  await clearAttempt(userId, taskId);
  return event;
}

async function finalize(userId: string, domain: DomainKey) {
  const before = await prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } } });
  await recomputeAll(userId, domain);
  const [after, leader, newAchievements] = await Promise.all([
    prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } } }),
    prisma.leaderProfile.findUnique({ where: { userId } }),
    evaluateAchievements(userId),
  ]);
  return {
    profile: {
      domain,
      before: before?.score ?? 0,
      after: after?.score ?? 0,
      confidence: after?.confidence ?? "low",
      summary: after?.summary ?? "",
      recommendedNext: after?.recommendedNext ?? "",
    },
    leader: leader ? { summary: leader.summary, recommendation: leader.recommendation } : null,
    newAchievements,
  };
}
