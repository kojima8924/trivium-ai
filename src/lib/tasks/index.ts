import type { DomainKey } from "../domain";
import { CODE_TASKS } from "./code";
import { COMPOSITE_TASKS } from "./composite";
import { READ_TASKS } from "./read";
import { WRITE_TASKS } from "./write";
import { CODE_STOCK } from "./stock/code.generated";
import { MIX_STOCK } from "./stock/mix.generated";
import { READ_STOCK } from "./stock/read.generated";
import { WRITE_STOCK } from "./stock/write.generated";
import { COMPOSITE_TYPE, isCompositeAxes } from "../task-types";
import type { Task } from "./types";

export * from "./types";

/** Python らしい passage か（LOGIC の手書き課題の taskType 補完用） */
function looksLikePythonPassage(passage: string | undefined): boolean {
  if (!passage) return false;
  return /^\s*(def |for |while |import |print\(|[a-zA-Z_]\w*\s*=\s*)/m.test(passage) && /(print\(|def |return )/.test(passage);
}

/** 複合課題（axes が 2 系統以上で正、または taskType が composite） */
export function isComposite(task: Pick<Task, "axes" | "taskType">): boolean {
  return task.taskType === COMPOSITE_TYPE.key || isCompositeAxes(task.axes);
}

/**
 * taskType を補完する（手書き課題には付いていない）。
 *   複合（axes 2 系統以上）→ composite / READ → skillTags から / WRITE → kind から / CODE → passage が Python か
 */
export function inferTaskType(task: Pick<Task, "domain" | "kind" | "skillTags" | "passage" | "axes" | "taskType">): string {
  if (task.taskType) return task.taskType;
  if (isCompositeAxes(task.axes)) return COMPOSITE_TYPE.key;
  if (task.domain === "READ") {
    if (task.skillTags.includes("critical_reading")) return "critique";
    if (task.skillTags.includes("inference")) return "inference";
    return "summary";
  }
  if (task.domain === "WRITE") return task.kind === "free" ? "argument" : "revision";
  return looksLikePythonPassage(task.passage) ? "python" : "puzzle";
}

function withTaskType(tasks: Task[]): Task[] {
  return tasks.map((t) => (t.taskType ? t : { ...t, taskType: inferTaskType(t) }));
}

/** 手書きの課題（デモ台本が id に依存するので常に優先） */
const HANDWRITTEN: Task[] = [...READ_TASKS, ...WRITE_TASKS, ...CODE_TASKS, ...COMPOSITE_TASKS];

/** 生成・検証済みのストック（scripts/stock/gen_stock.mts）。手書きと id が重なるものは除外する */
function mergeStock(base: Task[], stock: Task[]): Task[] {
  const ids = new Set(base.map((t) => t.id));
  const out = [...base];
  for (const t of stock) {
    if (ids.has(t.id)) {
      console.warn(`[tasks] stock id "${t.id}" duplicates a handwritten task; skipped`);
      continue;
    }
    ids.add(t.id);
    out.push(t);
  }
  return out;
}

export const ALL_TASKS: Task[] = withTaskType(mergeStock(HANDWRITTEN, [...READ_STOCK, ...WRITE_STOCK, ...CODE_STOCK, ...MIX_STOCK]));

const byId = new Map(ALL_TASKS.map((t) => [t.id, t]));

export function getTask(id: string): Task | undefined {
  return byId.get(id);
}

export function tasksFor(domain: DomainKey): Task[] {
  return ALL_TASKS.filter((t) => t.domain === domain);
}

/**
 * 次のタスクを選ぶ（決定論）。
 * 目標難易度に近く、未回答のものを優先。全て回答済みなら成功していないもの → 最も古いもの。
 * tieBreak を渡すと、難易度距離が同じ課題の並びをそれで決める（ユーザーごとにばらけさせる用。省略時は定義順）。
 * allow を渡すと pool をそれで絞る（出題設定で外した問題タイプの除外用）。絞った結果が空なら無視する。
 */
export function pickNextTask(
  domain: DomainKey,
  targetDifficulty: number,
  history: { taskId: string; success: boolean; createdAt: Date }[],
  preferredTaskId?: string,
  tieBreak?: (a: Task, b: Task) => number,
  allow?: (t: Task) => boolean,
): Task {
  const all = tasksFor(domain);
  const filtered = allow ? all.filter(allow) : all;
  const pool = filtered.length > 0 ? filtered : all;
  if (preferredTaskId) {
    const t = byId.get(preferredTaskId);
    if (t && t.domain === domain) return t;
  }
  const done = new Map<string, { success: boolean; createdAt: Date }>();
  for (const h of history) {
    const prev = done.get(h.taskId);
    if (!prev || prev.createdAt < h.createdAt) done.set(h.taskId, h);
  }
  const rank = (t: Task) => Math.abs(t.difficulty - targetDifficulty);
  const byRank = (a: Task, b: Task) => rank(a) - rank(b) || (tieBreak ? tieBreak(a, b) : 0);
  const unseen = pool.filter((t) => !done.has(t.id)).sort(byRank);
  if (unseen.length > 0) return unseen[0];
  const failed = pool
    .filter((t) => done.get(t.id)?.success === false)
    .sort(byRank);
  if (failed.length > 0) return failed[0];
  return [...pool].sort(
    (a, b) => done.get(a.id)!.createdAt.getTime() - done.get(b.id)!.createdAt.getTime(),
  )[0];
}

/**
 * 短答の正規化。日本語IMEで入力された全角英数・全角記号・全角スペースを半角に揃える。
 *   NFKC: ３.０ → 3.0、［４, １, ５］ → [4, 1, 5]、－ → -、全角スペース → 半角
 *   NFKC が扱わない Unicode のマイナス/ダッシュ（− ‐ ‑ – — ―）は明示的に '-' へ、「。」は '.' へ
 */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[−‐-―]/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[，、]/g, ",")
    .replace(/。/g, ".") // MS-IME の日本語モードでは "." が「。」になる（NFKC では畳まれない）
    .replace(/\s*,\s*/g, ", ")
    .replace(/[“”"'‘’]/g, "")
    .toLowerCase();
}

/**
 * 決定論的な採点。free タスクは null（AI 評価に委ねる）。
 */
export function checkDeterministic(task: Task, answer: string): boolean | null {
  if (task.kind === "free") return null;
  const keys = task.answerKey ?? [];
  if (task.kind === "choice") {
    return keys.includes(answer.trim());
  }
  const a = normalize(answer);
  return keys.some((k) => normalize(k) === a);
}

/**
 * free タスク用のヒューリスティック採点（Mock provider / Dify失敗時のフォールバック）。
 */
export function checkHeuristic(task: Task, answer: string): { pass: boolean; reasons: string[] } {
  const r = task.rubric;
  const text = answer.trim();
  const reasons: string[] = [];
  if (!r) return { pass: text.length > 0, reasons };
  const len = [...text].length;
  if (r.minLength && len < r.minLength) reasons.push(`短すぎます（${len}字。目安 ${r.minLength}字以上）`);
  if (r.maxLength && len > r.maxLength) reasons.push(`長すぎます（${len}字。目安 ${r.maxLength}字以内）`);
  if (r.mustInclude && r.mustInclude.length > 0) {
    const hit = r.mustInclude.some((k) => text.includes(k));
    if (!hit) reasons.push("評価観点に対応する要素が読み取れませんでした");
  }
  return { pass: reasons.length === 0, reasons };
}
