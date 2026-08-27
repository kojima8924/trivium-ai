import type { DomainKey } from "../domain";
import { CODE_TASKS } from "./code";
import { READ_TASKS } from "./read";
import { WRITE_TASKS } from "./write";
import type { Task } from "./types";

export * from "./types";

export const ALL_TASKS: Task[] = [...READ_TASKS, ...WRITE_TASKS, ...CODE_TASKS];

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
 */
export function pickNextTask(
  domain: DomainKey,
  targetDifficulty: number,
  history: { taskId: string; success: boolean; createdAt: Date }[],
  preferredTaskId?: string,
): Task {
  const pool = tasksFor(domain);
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
  const unseen = pool.filter((t) => !done.has(t.id)).sort((a, b) => rank(a) - rank(b));
  if (unseen.length > 0) return unseen[0];
  const failed = pool
    .filter((t) => done.get(t.id)?.success === false)
    .sort((a, b) => rank(a) - rank(b));
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
