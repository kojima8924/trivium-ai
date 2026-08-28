// 回答の採点と決着。決定論の採点 → AI の講評/一段ヒント（選択式はキャッシュ）→ 決着なら learning_event を記録。
// 「答えを教えない・ヒントは一段ずつ」を守るため、成功以外は必ず 1 段だけヒントを返して retry にする。
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../prisma";
import { learningAI, type DomainEvalOutput } from "../ai";
import { MAX_HINTS, SUBSKILLS, toUserWording, type DomainKey } from "../domain";
import { checkDeterministic, checkHeuristic, toPublic, type Task } from "../tasks";
import { subskillsOf } from "../profile";
import { personaPrompts } from "../persona";
import { axesOf } from "../scoring";
import { resolveTask } from "./resolve";
import { finalizeOrDefer, finalizeStub } from "./finalize";
import type { SettledSubmitResult, SubmitOptions, SubmitResult } from "./types";

const MODE: Record<DomainKey, "read" | "write" | "code"> = { READ: "read", WRITE: "write", CODE: "code" };
/** 同じ課題の決着がこの時間内に 2 回来たら二重送信（LINE のボタン連打など）とみなして記録しない */
const DUPLICATE_SETTLE_MS = 60 * 1000;

type Settlement =
  | { status: "success"; feedback: string; observations: string[] }
  | { status: "failed"; feedback: string };

/**
 * 出題中の課題に対する「ヒントだけ」の要求（LINE の「ヒント」「わからない」）。
 * 回答は記録せず、TaskAttempt の hintCount だけ進める（あとで正解したときの XP と証拠の重みに反映される）。
 * 使い切っていれば hint は null。
 */
export async function requestHint(userId: string, taskId: string): Promise<{ hint: string | null; hintCount: number; hintsRemaining: number } | null> {
  const task = await resolveTask(userId, taskId);
  if (!task) return null;
  const attempt = await prisma.taskAttempt.findUnique({ where: { userId_taskId: { userId, taskId } } });
  const used = attempt ? Math.min(attempt.hintCount, MAX_HINTS) : 0;
  if (used >= MAX_HINTS || !task.hints[used]) return { hint: null, hintCount: used, hintsRemaining: 0 };
  const next = used + 1;
  await prisma.taskAttempt.upsert({
    where: { userId_taskId: { userId, taskId } },
    update: { hintCount: next },
    create: { userId, taskId, hintCount: next },
  });
  return { hint: toUserWording(task.hints[used]), hintCount: next, hintsRemaining: MAX_HINTS - next };
}

/**
 * 回答を処理する。決着（success/failed）時は learning_event を記録し、
 * deferFinalize でなければ profile/ADVISOR を再計算して結果に含める。
 */
export async function submitAnswer(userId: string, taskId: string, opts: SubmitOptions): Promise<SubmitResult | { error: "unknown_task" }> {
  const task = await resolveTask(userId, taskId);
  if (!task) return { error: "unknown_task" };
  const answer = opts.answer;

  // ヒント回数はサーバが持つ TaskAttempt が正本（時間が空いても受け取ったヒントの数は変わらない。決着時に消す）
  const attempt = await prisma.taskAttempt.findUnique({ where: { userId_taskId: { userId, taskId } } });
  const hintCount = attempt ? Math.min(attempt.hintCount, MAX_HINTS) : 0;

  if (opts.giveUp) {
    return settleAnswer(userId, task, answer, hintCount, opts, task.skillTags, {
      status: "failed",
      feedback: "今回はここまでにしましょう。解説を読んで、次に同じ形の問題に出会ったときの足がかりにしてください。",
    });
  }

  const deterministic = checkDeterministic(task, answer);
  const heuristic = deterministic === null ? checkHeuristic(task, answer).pass : null;

  const ai = await evaluateWithCache(userId, task, answer, deterministic, heuristic, hintCount);
  const success = ai.status === "success";
  const skillTags = Array.from(new Set([...task.skillTags, ...ai.skillTags.filter((t) => task.skillTags.includes(t))]));

  if (success) {
    return settleAnswer(userId, task, answer, hintCount, opts, skillTags, {
      status: "success",
      feedback: ai.feedback,
      observations: ai.observations,
    });
  }

  const nextHintCount = hintCount + 1;
  if (nextHintCount >= MAX_HINTS + 1) {
    return settleAnswer(userId, task, answer, hintCount, opts, skillTags, {
      status: "failed",
      feedback: "ヒントを使い切りました。解説を読んで、次に同じ形の問題に出会ったときの足がかりにしてください。",
    });
  }

  await prisma.taskAttempt.upsert({
    where: { userId_taskId: { userId, taskId } },
    update: { hintCount: nextHintCount },
    create: { userId, taskId, hintCount: nextHintCount },
  });
  return {
    status: "retry",
    task: toPublic(task),
    feedback: ai.feedback,
    hint: ai.hint,
    hintCount: nextHintCount,
    hintsRemaining: MAX_HINTS - nextHintCount,
  };
}

/** 決着時の記録・再計算（または延期）・共通レスポンス組み立てを一か所で行う。 */
async function settleAnswer(
  userId: string,
  task: Task,
  answer: string,
  hintCount: number,
  opts: SubmitOptions,
  skillTags: string[],
  settlement: Settlement,
): Promise<SettledSubmitResult> {
  // 決着済み（正解済み）の課題への再挑戦と、同じ課題の二重送信は「練習モード」: 講評は返すが記録・XP・レベルは変えない
  const practice = await isPractice(userId, task.id);
  const event = practice ? null : await record(userId, task, answer, settlement.status === "success", hintCount, opts.latencyMs, skillTags);
  const finalized = practice ? await finalizeStub(userId, task.domain) : await finalizeOrDefer(userId, task.domain, opts.deferFinalize);
  const common = {
    task: toPublic(task),
    feedback: settlement.feedback,
    hint: "" as const,
    explanation: task.explanation,
    ...(task.kind === "free" && task.rubric?.sampleAnswer ? { sampleAnswer: task.rubric.sampleAnswer } : {}),
    hintCount,
    event: { id: event?.id ?? "" },
    ...(practice ? { practice: true } : {}),
    ...finalized,
  };
  if (settlement.status === "success") {
    return { status: "success", ...common, observations: settlement.observations };
  }
  return { status: "failed", ...common };
}

/**
 * 記録しない決着かどうか: すでに正解済みの課題、または同じ課題の決着が直前（DUPLICATE_SETTLE_MS 以内）にある。
 * 既知の正解を繰り返し送って XP・レベルを水増しする経路と、LINE のボタン連打による二重記録を塞ぐ。
 */
async function isPractice(userId: string, taskId: string): Promise<boolean> {
  const recent = await prisma.learningEvent.findFirst({
    where: { userId, taskId, OR: [{ success: true }, { createdAt: { gte: new Date(Date.now() - DUPLICATE_SETTLE_MS) } }] },
    select: { id: true },
  });
  return recent !== null;
}

/** 選択式は (task, 回答, ヒント段階, 人格) で講評をキャッシュし、2回目以降は LLM を呼ばない */
async function evaluateWithCache(
  userId: string,
  task: Task,
  answer: string,
  deterministic: boolean | null,
  heuristic: boolean | null,
  hintCount: number,
): Promise<DomainEvalOutput> {
  const personas = await personaPrompts(userId);
  const persona = personas[task.domain];
  const cacheable = task.kind === "choice" && deterministic !== null;
  const cacheKey = { taskId: task.id, answer: answer.trim(), hintLevel: hintCount, personaKey: persona.key };

  if (cacheable) {
    const hit = await prisma.taskFeedbackCache.findUnique({ where: { taskId_answer_hintLevel_personaKey: cacheKey } });
    if (hit) return hit.payload as unknown as DomainEvalOutput;
  }

  const [profile, recent] = await Promise.all([
    prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain: task.domain } } }),
    prisma.learningEvent.findMany({
      where: { userId, domain: task.domain },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { taskId: true, success: true, hintCount: true, difficulty: true },
    }),
  ]);

  const out = await learningAI.evaluate({
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
    // 選択式の講評は他の学習者とも共有されるキャッシュなので、個人のプロフィール（寸評・傾向）と履歴は渡さない
    currentDomainProfile: cacheable
      ? { score: 0, subskills: {}, confidence: "low", evidenceCount: 0, summary: "" }
      : {
          score: profile?.score ?? 0,
          subskills: subskillsOf(profile?.subskills ?? {}),
          confidence: (profile?.confidence as "low" | "medium" | "high") ?? "low",
          evidenceCount: profile?.evidenceCount ?? 0,
          summary: profile?.summary ?? "",
        },
    recentBehavior: cacheable ? [] : recent.map((r) => `${r.taskId}: ${r.success ? "success" : "failure"} (hints=${r.hintCount}, difficulty=${r.difficulty})`),
    persona,
  });

  if (cacheable) {
    await prisma.taskFeedbackCache
      .upsert({
        where: { taskId_answer_hintLevel_personaKey: cacheKey },
        update: { payload: out as unknown as Prisma.InputJsonValue },
        create: { ...cacheKey, payload: out as unknown as Prisma.InputJsonValue },
      })
      .catch(() => undefined);
  }
  return { ...out, feedback: toUserWording(out.feedback), hint: toUserWording(out.hint), observations: out.observations.map(toUserWording) };
}

/** learning_event を 1 行書き、出題中の状態（LINE の pendingTask / TaskAttempt）を片づける */
async function record(
  userId: string,
  task: Task,
  answer: string,
  success: boolean,
  hintCount: number,
  latencyMs: number | undefined,
  skillTags: string[],
) {
  const axes = axesOf(task);
  const event = await prisma.learningEvent.create({
    data: {
      userId,
      domain: task.domain,
      taskId: task.id,
      difficulty: task.difficulty,
      axisRead: axes.read,
      axisWrite: axes.write,
      axisCode: axes.code,
      generated: task.id.startsWith("gen-"),
      answer: answer.slice(0, 4000),
      success,
      hintCount,
      latencyMs,
      skillTags: skillTags.filter((t) => (SUBSKILLS[task.domain] as readonly string[]).includes(t)),
    },
  });
  // LINE で出題中のままの課題を Web で解いた場合、LINE 側の「回答待ち」を解除する（戻ったとき古い問題が残らない）
  await clearLinePendingTask(userId, task.id).catch((err) => console.warn("[learn] clear LINE pending failed:", (err as Error).message));
  await prisma.taskAttempt.deleteMany({ where: { userId, taskId: task.id } });
  return event;
}

/** LINE の state.pendingTask がこの課題なら外す（決着した課題を LINE 上に残さない） */
async function clearLinePendingTask(userId: string, taskId: string): Promise<void> {
  const rows = await prisma.lineUser.findMany({ where: { userId }, select: { id: true, state: true } });
  for (const row of rows) {
    const state = (row.state ?? {}) as Record<string, unknown>;
    const pending = state.pendingTask as { taskId?: string } | undefined;
    if (!pending || pending.taskId !== taskId) continue;
    const { pendingTask: _drop, ...rest } = state;
    void _drop;
    await prisma.lineUser.update({ where: { id: row.id }, data: { state: rest as object } });
  }
}

/**
 * 選択式の講評キャッシュを事前に温める（デモ前・LINE の即答用）。
 * 指定ユーザーの人格で、各選択肢 × ヒント段階 0 の講評を生成して保存する。
 * 既にキャッシュがあるものは飛ばす。戻り値は生成した件数。
 */
export async function warmFeedbackCache(userId: string, taskIds: string[], opts: { hintLevels?: number[]; concurrency?: number } = {}): Promise<number> {
  const hintLevels = opts.hintLevels ?? [0];
  const concurrency = opts.concurrency ?? 3;
  const jobs: { task: Task; answer: string; hintLevel: number }[] = [];
  for (const id of taskIds) {
    const task = await resolveTask(userId, id);
    if (!task || task.kind !== "choice" || !task.choices) continue;
    for (let i = 0; i < task.choices.length; i++) for (const h of hintLevels) jobs.push({ task, answer: String(i), hintLevel: h });
  }
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const j = jobs[cursor++];
      const deterministic = checkDeterministic(j.task, j.answer);
      await evaluateWithCache(userId, j.task, j.answer, deterministic, null, j.hintLevel);
      done++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return done;
}
