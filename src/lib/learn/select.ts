// 次に出す課題を選ぶ。難易度（推薦＋ゆらぎ、または本人の明示指定）で候補を絞り、
// 出題設定（外した問題タイプ・複合問題）と弱い subskill を反映して 1 問に決める。
// 乱数は使わず、ユーザーごとに決定論的にばらけさせる（同じ状態なら常に同じ課題）。
import "server-only";
import { prisma } from "../prisma";
import type { DomainKey } from "../domain";
import { getTask, pickNextTask, tasksFor, type Task } from "../tasks";
import { nextDifficultyFor, subskillsOf } from "../profile";
import { adaptiveTarget, clampDifficulty } from "../scoring";
import { fnv1a } from "../hash";
import { loadTaskPrefs } from "../task-prefs";
import { PYTHON_TASK_TYPES, pythonGateAllows, taskAllowedByPrefs } from "../task-types";
import { resolveTask } from "./resolve";

export type NextTaskOptions = {
  /** 指定があればその課題をそのまま出す（Web の「この問題を解く」） */
  preferredTaskId?: string;
  /** 形式で絞る（LINE は選択式のみ） */
  kind?: Task["kind"];
  /** 本人の明示指定（「難易度8」）。無ければ推薦＋ゆらぎ */
  targetDifficulty?: number;
  /** 直前にパスした課題など、今回は出さない id */
  excludeTaskIds?: string[];
  /** 本人の希望する問題タイプ（「Python やさしめ」） */
  taskType?: string;
};

/** 最も弱い subskill（同点なら定義順で先のもの）。推薦文と出題を揃えるために使う */
function weakestSubskill(subskills: Record<string, number>): string | null {
  const entries = Object.entries(subskills);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => a[1] - b[1])[0][0];
}

export async function nextTask(userId: string, domain: DomainKey, opts: NextTaskOptions = {}): Promise<{ task: Task; targetDifficulty: number }> {
  if (opts.preferredTaskId) {
    const t = await resolveTask(userId, opts.preferredTaskId);
    if (t && t.domain === domain) return { task: t, targetDifficulty: t.difficulty };
  }
  const [history, recommended, profile, prefs] = await Promise.all([
    prisma.learningEvent.findMany({ where: { userId, domain }, select: { taskId: true, success: true, createdAt: true } }),
    nextDifficultyFor(userId, domain),
    prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } }, select: { subskills: true } }),
    loadTaskPrefs(userId),
  ]);
  // 本人の明示指定（LINE「難易度8」）があれば推薦より優先する。
  // 無ければ推薦値に決定論的なゆらぎを加える（最初は低め・広めに探索し、回答が増えるほど推薦値の周辺に収束）
  const explicit = opts.targetDifficulty !== undefined;
  const targetDifficulty = explicit
    ? clampDifficulty(Math.round(opts.targetDifficulty as number))
    : adaptiveTarget(recommended, history.length, `${userId}:${domain}:${history.length}`);
  const seen = new Set(history.map((h) => h.taskId));
  for (const id of opts.excludeTaskIds ?? []) seen.add(id);
  // Python 系を易しい帯で出すのは、その人が Python 系で 1 度でも正解してからにする（未経験者の LOGIC が文法で沈むのを防ぐ）
  const solvedPythonBefore = history.some((h) => {
    if (!h.success) return false;
    const t = getTask(h.taskId);
    return t?.taskType !== undefined && PYTHON_TASK_TYPES.includes(t.taskType);
  });
  const gate = { solvedPythonBefore, requestedTaskType: opts.taskType };
  // 出題設定（/settings で外した問題タイプ・複合問題）と Python ゲートを反映。
  // 絞った結果が空なら設定を無視する（出題不能を避ける）
  const allow = (t: Task) => taskAllowedByPrefs(t, prefs) && pythonGateAllows(t, gate);
  let pool = tasksFor(domain);
  if (opts.kind) pool = pool.filter((t) => t.kind === opts.kind);
  // 本人が問題タイプを指定していれば（「Python やさしめ」など）そのタイプに絞る。空なら無視する
  if (opts.taskType) {
    const typed = pool.filter((t) => t.taskType === opts.taskType);
    if (typed.length > 0) pool = typed;
    else console.warn(`[learn] no ${domain} task of type ${opts.taskType}; ignoring the type`);
  }
  const allowedPool = pool.filter(allow);
  if (allowedPool.length > 0) pool = allowedPool;
  else if (pool.length > 0) console.warn(`[learn] task prefs exclude every ${domain}${opts.kind ? `/${opts.kind}` : ""} task; ignoring prefs`);

  // 弱い subskill を含む未回答の課題を優先（推薦文と出題を整合させる）。
  // ただし狙いの難易度から 2 以上離れる課題は選ばない（「難易度8 のつもりが 2 が出る」を防ぐ）
  const weakest = weakestSubskill(subskillsOf(profile?.subskills ?? {}));
  const rank = (t: Task) => Math.abs(t.difficulty - targetDifficulty);
  // 難易度距離が同じ課題は、ユーザーごとに決定論的にばらけさせる（全員が同じ順で同じ問題にならない。乱数は使わない）
  const tieBreak = (a: Task, b: Task) => fnv1a(`${userId}:${a.id}`) - fnv1a(`${userId}:${b.id}`);
  const byRank = (a: Task, b: Task) => rank(a) - rank(b) || tieBreak(a, b);
  const unseen = pool.filter((t) => !seen.has(t.id));
  const preferred = weakest ? unseen.filter((t) => t.skillTags.includes(weakest) && rank(t) <= 1).sort(byRank)[0] : undefined;
  if (preferred) return { task: preferred, targetDifficulty };
  if (opts.kind) {
    const next = unseen.sort(byRank)[0] ?? pool.sort(byRank)[0];
    if (next) return { task: next, targetDifficulty };
  }
  return { task: pickNextTask(domain, targetDifficulty, history, undefined, tieBreak, allow), targetDifficulty };
}
