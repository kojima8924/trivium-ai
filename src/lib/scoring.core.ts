// スコア集計の土台（型・難易度ベクトル・重み）。数式はここに集約し、scoring.ts は判定と組み立てだけを持つ。
// 係数は src/config/trivium.config.ts の SCORING で調整する。ここに DB も LLM も入れない（純粋関数だけ）。
import { SCORING } from "@/config/trivium.config";
import { type Confidence, type DomainKey } from "./domain";

export type Axes = { read: number; write: number; code: number };

export type ScorableEvent = {
  domain: DomainKey;
  /** 主系統の難易度（1..10）。axes が無い旧データではこれを主系統に割り当てる */
  difficulty: number;
  /** 難易度ベクトル（0 = 無関係）。複合課題は複数系統が正 */
  axes?: Partial<Axes> | null;
  success: boolean;
  hintCount: number;
  skillTags: string[];
  createdAt: Date;
};

export type DomainScore = {
  domain: DomainKey;
  /** 0..100（到達レベル×10 + 進捗。小数 1 桁） */
  score: number;
  /** 到達レベル 0..10 */
  level: number;
  /** 次のレベルへの進捗 0..1 */
  progress: number;
  subskills: Record<string, number>;
  evidenceCount: number;
  confidence: Confidence;
  successRate: number;
  avgHints: number;
  avgDifficulty: number;
};

export const MAX_LEVEL = 10;

/** 系統 → 難易度ベクトルの軸名 / その逆 */
export const AXIS_OF: Record<DomainKey, keyof Axes> = { READ: "read", WRITE: "write", CODE: "code" };
export const DOMAIN_OF_AXIS: Record<keyof Axes, DomainKey> = { read: "READ", write: "WRITE", code: "CODE" };

/** 表示用: 小数 1 桁（72.4）。Dashboard / LINE / 結果カードで統一して使う */
export function formatScore(score: number): string {
  return (Math.round(score * 10) / 10).toFixed(1);
}

/** 小数 1 桁に丸める */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 難易度ベクトルの成分（0 = 無関係。それ以外は 1..10 の整数に丸める） */
function clampLevel(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_LEVEL, Math.max(1, Math.round(n)));
}

/** 出題難易度として有効な範囲（1..10）に収める。0 は 1 に上げる（clampLevel と違い「無関係」は無い） */
export function clampDifficulty(n: number): number {
  return Math.min(MAX_LEVEL, Math.max(1, n));
}

/** 課題/イベントの難易度ベクトルを正規化する（旧データは主系統だけ） */
export function axesOf(e: { domain: DomainKey; difficulty: number; axes?: Partial<Axes> | null }): Axes {
  const a = e.axes ?? {};
  const out: Axes = { read: clampLevel(a.read ?? 0), write: clampLevel(a.write ?? 0), code: clampLevel(a.code ?? 0) };
  if (out.read + out.write + out.code === 0) out[AXIS_OF[e.domain]] = clampLevel(e.difficulty);
  return out;
}

/** 1 件の基礎点（成功はヒント数で減る / 失敗は固定） */
export function baseScore(success: boolean, hintCount: number): number {
  if (!success) return SCORING.failureBase;
  const table = SCORING.successBase;
  return table[Math.min(hintCount, table.length - 1)];
}

/** 難易度重み（1 → 0.7 … 10 → 1.3）。subskill の集計に使う */
export function difficultyWeight(difficulty: number): number {
  const d = Math.min(MAX_LEVEL, Math.max(1, difficulty));
  return 0.7 + ((d - 1) / (MAX_LEVEL - 1)) * 0.6;
}

/** 新しさ重み（半減期は SCORING.recencyHalfLifeDays） */
export function recencyWeight(createdAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / SCORING.recencyHalfLifeDays);
}

/** 証拠量 → 確からしさの 3 段階 */
export function confidenceFor(evidenceCount: number): Confidence {
  if (evidenceCount < SCORING.confidence.medium) return "low";
  if (evidenceCount < SCORING.confidence.high) return "medium";
  return "high";
}

/** 重み付き平均（重みの合計が 0 なら 0） */
export function weightedMean(items: { value: number; weight: number }[]): number {
  let num = 0;
  let den = 0;
  for (const it of items) {
    num += it.value * it.weight;
    den += it.weight;
  }
  return den === 0 ? 0 : num / den;
}
