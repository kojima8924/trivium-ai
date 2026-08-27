// 学習ループのサービス層。Web の API ルートと LINE webhook の両方から使う。
//   resolveTask   : 静的タスク or LLM 生成タスク（GeneratedTask）を同じ Task 型で取り出す
//   nextTask      : 次の課題を選ぶ（弱い subskill を優先）
//   submitAnswer  : 採点 → AI の講評/一段ヒント（選択式はキャッシュ）→ 決着時に learning_event を記録
//   finalize      : profile / Leader の再計算、achievement、スナップショット
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../prisma";
import { learningAI, type DomainEvalOutput } from "../ai";
import { MAX_HINTS, SUBSKILLS, toUserWording, type DomainKey } from "../domain";
import { checkDeterministic, checkHeuristic, getTask, pickNextTask, tasksFor, type Task, type TaskPublic, toPublic } from "../tasks";
import { loadEvents, nextDifficultyFor, recomputeAll, subskillsOf } from "../profile";
import { evaluateAchievements } from "../achievements";
import { personaPrompts } from "../persona";
import { axesOf, computeDomainScore } from "../scoring";
import { computeXp } from "../xp";
import { notifyDailyDigestIfComplete } from "./digest";
import { updateLeaderMemory, updateMemoryAfterEvent } from "../memory";

const MODE: Record<DomainKey, "read" | "write" | "code"> = { READ: "read", WRITE: "write", CODE: "code" };
const ATTEMPT_STALE_MS = 6 * 60 * 60 * 1000;

// ---- タスク解決（静的 + 生成） ----

function rowToTask(r: {
  id: string;
  domain: string;
  difficulty: number;
  axisRead?: number;
  axisWrite?: number;
  axisCode?: number;
  title: string;
  passage: string;
  prompt: string;
  kind: string;
  choices: Prisma.JsonValue | null;
  answerKey: Prisma.JsonValue | null;
  rubric: Prisma.JsonValue | null;
  hints: Prisma.JsonValue;
  explanation: string;
  skillTags: string[];
}): Task {
  const strs = (v: Prisma.JsonValue | null | undefined): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const rubric =
    r.rubric && typeof r.rubric === "object" && !Array.isArray(r.rubric)
      ? {
          mustInclude: strs((r.rubric as Record<string, Prisma.JsonValue>).mustInclude),
          minLength: Number((r.rubric as Record<string, unknown>).minLength ?? 0) || undefined,
          maxLength: Number((r.rubric as Record<string, unknown>).maxLength ?? 0) || undefined,
          criteria: strs((r.rubric as Record<string, Prisma.JsonValue>).criteria),
        }
      : undefined;
  const axes = { read: r.axisRead ?? 0, write: r.axisWrite ?? 0, code: r.axisCode ?? 0 };
  return {
    id: r.id,
    domain: r.domain as DomainKey,
    difficulty: r.difficulty,
    axes: axes.read + axes.write + axes.code > 0 ? axes : undefined,
    title: r.title,
    passage: r.passage || undefined,
    prompt: r.prompt,
    kind: r.kind as Task["kind"],
    choices: r.kind === "choice" ? strs(r.choices) : undefined,
    answerKey: strs(r.answerKey),
    rubric,
    hints: strs(r.hints),
    explanation: r.explanation,
    skillTags: r.skillTags,
  };
}

/** taskId から Task を取り出す。生成タスクは本人のものだけ見える */
export async function resolveTask(userId: string, taskId: string): Promise<Task | null> {
  const s = getTask(taskId);
  if (s) return s;
  if (!taskId.startsWith("gen-")) return null;
  const row = await prisma.generatedTask.findFirst({ where: { id: taskId, userId } });
  return row ? rowToTask(row) : null;
}

// ---- 次の課題 ----

export async function nextTask(
  userId: string,
  domain: DomainKey,
  opts: { preferredTaskId?: string; kind?: Task["kind"]; targetDifficulty?: number; excludeTaskIds?: string[] } = {},
): Promise<{ task: Task; targetDifficulty: number }> {
  if (opts.preferredTaskId) {
    const t = await resolveTask(userId, opts.preferredTaskId);
    if (t && t.domain === domain) return { task: t, targetDifficulty: t.difficulty };
  }
  const [history, recommended, profile] = await Promise.all([
    prisma.learningEvent.findMany({ where: { userId, domain }, select: { taskId: true, success: true, createdAt: true } }),
    nextDifficultyFor(userId, domain),
    prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } }, select: { subskills: true } }),
  ]);
  // 本人の明示指定（LINE「難易度8」）があれば推薦より優先する
  const explicit = opts.targetDifficulty !== undefined;
  const targetDifficulty = explicit ? Math.min(10, Math.max(1, Math.round(opts.targetDifficulty as number))) : recommended;
  const seen = new Set(history.map((h) => h.taskId));
  for (const id of opts.excludeTaskIds ?? []) seen.add(id);
  let pool = tasksFor(domain);
  if (opts.kind) pool = pool.filter((t) => t.kind === opts.kind);

  // 弱い subskill を含む未回答の課題を優先（推薦文と出題を整合させる）。
  // ただし狙いの難易度から 2 以上離れる課題は選ばない（「難易度8 のつもりが 2 が出る」を防ぐ）
  const weakest = weakestSubskill(subskillsOf(profile?.subskills ?? {}));
  const rank = (t: Task) => Math.abs(t.difficulty - targetDifficulty);
  const unseen = pool.filter((t) => !seen.has(t.id));
  const preferred = weakest
    ? unseen
        .filter((t) => t.skillTags.includes(weakest) && rank(t) <= 1)
        .sort((a, b) => rank(a) - rank(b))[0]
    : undefined;
  if (preferred) return { task: preferred, targetDifficulty };
  if (opts.kind) {
    const next = unseen.sort((a, b) => rank(a) - rank(b))[0] ?? pool.sort((a, b) => rank(a) - rank(b))[0];
    if (next) return { task: next, targetDifficulty };
  }
  return { task: pickNextTask(domain, targetDifficulty, history), targetDifficulty };
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

function weakestSubskill(subskills: Record<string, number>): string | null {
  const entries = Object.entries(subskills);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => a[1] - b[1])[0][0];
}

// ---- 回答 ----

export type SubmitResult =
  | {
      status: "retry";
      task: TaskPublic;
      feedback: string;
      hint: string;
      hintCount: number;
      hintsRemaining: number;
    }
  | {
      status: "success" | "failed";
      task: TaskPublic;
      feedback: string;
      hint: "";
      explanation: string;
      hintCount: number;
      observations?: string[];
      event: { id: string };
      profile: { domain: DomainKey; before: number; after: number; confidence: string; summary: string; recommendedNext: string };
      leader: { summary: string; recommendation: string } | null;
      newAchievements: string[];
    };

export type SubmitOptions = {
  answer: string;
  latencyMs?: number;
  giveUp?: boolean;
  /** true なら決着後の再計算（finalize）を呼び出し側に任せる（LINE で先に返信したいとき） */
  deferFinalize?: boolean;
};

type SettledSubmitResult = Extract<SubmitResult, { status: "success" | "failed" }>;
type Settlement =
  | { status: "success"; feedback: string; observations: string[] }
  | { status: "failed"; feedback: string };

/**
 * 回答を処理する。決着（success/failed）時は learning_event を記録し、
 * deferFinalize でなければ profile/Leader を再計算して結果に含める。
 */
export async function submitAnswer(userId: string, taskId: string, opts: SubmitOptions): Promise<SubmitResult | { error: "unknown_task" }> {
  const task = await resolveTask(userId, taskId);
  if (!task) return { error: "unknown_task" };
  const answer = opts.answer;

  // ヒント回数はサーバが持つ TaskAttempt が正本
  const attempt = await prisma.taskAttempt.findUnique({ where: { userId_taskId: { userId, taskId } } });
  const stale = attempt ? Date.now() - attempt.updatedAt.getTime() > ATTEMPT_STALE_MS : false;
  const hintCount = attempt && !stale ? Math.min(attempt.hintCount, MAX_HINTS) : 0;

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
  const event = await record(userId, task, answer, settlement.status === "success", hintCount, opts.latencyMs, skillTags);
  const finalized = await finalizeOrDefer(userId, task.domain, opts.deferFinalize);
  const common = {
    task: toPublic(task),
    feedback: settlement.feedback,
    hint: "" as const,
    explanation: task.explanation,
    hintCount,
    event: { id: event.id },
    ...finalized,
  };
  if (settlement.status === "success") {
    return { status: "success", ...common, observations: settlement.observations };
  }
  return { status: "failed", ...common };
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
    currentDomainProfile: {
      score: profile?.score ?? 0,
      subskills: subskillsOf(profile?.subskills ?? {}),
      confidence: (profile?.confidence as "low" | "medium" | "high") ?? "low",
      evidenceCount: profile?.evidenceCount ?? 0,
      summary: profile?.summary ?? "",
    },
    // 選択式の講評は他の学習者とも共有されるキャッシュなので、個人の履歴は渡さない
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

export type FinalizeResult = {
  profile: {
    domain: DomainKey;
    before: number;
    after: number;
    /** 到達レベル（0..10）の前後 */
    levelBefore: number;
    levelAfter: number;
    confidence: string;
    summary: string;
    recommendedNext: string;
  };
  /** この決着で得た XP と合計・ランク */
  xp: { gained: number; total: number; rank: string };
  leader: { summary: string; recommendation: string } | null;
  newAchievements: string[];
};

async function finalizeOrDefer(userId: string, domain: DomainKey, defer?: boolean): Promise<FinalizeResult> {
  if (defer) {
    const before = await prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } } });
    const score = before?.score ?? 0;
    return {
      profile: {
        domain,
        before: score,
        after: score,
        levelBefore: Math.floor(score / 10),
        levelAfter: Math.floor(score / 10),
        confidence: before?.confidence ?? "low",
        summary: before?.summary ?? "",
        recommendedNext: before?.recommendedNext ?? "",
      },
      xp: { gained: 0, total: 0, rank: "" },
      leader: null,
      newAchievements: [],
    };
  }
  return finalize(userId, domain);
}

/** 決着後の再計算。profile/Leader を更新し、achievement とスナップショットを記録する */
export async function finalize(userId: string, domain: DomainKey): Promise<FinalizeResult> {
  const before = await prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } } });
  // XP は決定論なので「直前の記録を除いた合計」と「含めた合計」の差が今回の獲得分
  const eventsAfter = await loadEvents(userId);
  const xpAfter = computeXp(eventsAfter);
  const xpBefore = computeXp(eventsAfter.slice(0, -1));
  await recomputeAll(userId, domain);
  const [after, leader, newAchievements] = await Promise.all([
    prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } } }),
    prisma.leaderProfile.findUnique({ where: { userId } }),
    evaluateAchievements(userId),
  ]);
  await snapshot(userId);
  // 系統エージェントの観察メモ → 案内役のメモ、の順で更新（失敗しても学習ループは止めない）
  void (async () => {
    const last = await prisma.learningEvent.findFirst({ where: { userId, domain }, orderBy: { createdAt: "desc" } });
    if (!last) return;
    const task = await resolveTask(userId, last.taskId);
    await updateMemoryAfterEvent(userId, domain, {
      taskTitle: task?.title ?? last.taskId,
      domain,
      axes: { read: last.axisRead, write: last.axisWrite, code: last.axisCode },
      success: last.success,
      hintCount: last.hintCount,
      answer: last.answer,
    });
    await updateLeaderMemory(userId);
  })().catch((err) => console.warn("[memory] update failed:", (err as Error).message));
  // Web からの回答でも「今日の3問」が揃えば LINE に総評を push（DailyDigest の unique で冪等）
  void notifyDailyDigestIfComplete(userId).catch(() => undefined);
  const levelAfter = computeDomainScore(domain, eventsAfter).level;
  return {
    profile: {
      domain,
      before: before?.score ?? 0,
      after: after?.score ?? 0,
      levelBefore: Math.floor((before?.score ?? 0) / 10),
      levelAfter,
      confidence: after?.confidence ?? "low",
      summary: after?.summary ?? "",
      recommendedNext: after?.recommendedNext ?? "",
    },
    xp: { gained: Math.max(0, xpAfter.total - xpBefore.total), total: xpAfter.total, rank: xpAfter.rank.title },
    leader: leader ? { summary: leader.summary, recommendation: leader.recommendation } : null,
    newAchievements,
  };
}

/** 能力の時系列（3軸のスコアを 1 行保存） */
export async function snapshot(userId: string): Promise<void> {
  const events = await loadEvents(userId);
  const read = computeDomainScore("READ", events).score;
  const write = computeDomainScore("WRITE", events).score;
  const code = computeDomainScore("CODE", events).score;
  await prisma.profileSnapshot.create({ data: { userId, read, write, code } }).catch(() => undefined);
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
