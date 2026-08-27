// 能力スコアの決定論的集計（数値 = evidence）。LLM はここに関与しない。
//
// モデル（src/config/trivium.config.ts の SCORING で調整）:
//   - 難易度は系統ごとに 1〜10。各課題は難易度ベクトル { read, write, code }（0 = 無関係）を持つ
//   - 成功は関与する全系統に「その難易度以下は解ける」証拠を与える
//   - 失敗は「相対的に最も難しかった系統（ボトルネック）」だけに、その難易度付近の否定証拠を与える
//   - 到達レベル L = 「難易度 d 以上の正答率が threshold 以上」を満たす最大の d（それ未満は 100% とみなす）
//   - 表示スコア（0〜100）= L×10 + 次のレベルへの進捗×10
//   - subskill（観点別 0〜100）は従来どおり基礎点×難易度×新しさの重み付き平均（証拠バー用）
import { SCORING } from "@/config/trivium.config";
import { type Confidence, type DomainKey, DOMAINS, SUBSKILLS } from "./domain";

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
  /** 0..100（到達レベル×10 + 進捗） */
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
const AXIS_OF: Record<DomainKey, keyof Axes> = { READ: "read", WRITE: "write", CODE: "code" };
export const DOMAIN_OF_AXIS: Record<keyof Axes, DomainKey> = { read: "READ", write: "WRITE", code: "CODE" };

/** 課題/イベントの難易度ベクトルを正規化する（旧データは主系統だけ） */
export function axesOf(e: { domain: DomainKey; difficulty: number; axes?: Partial<Axes> | null }): Axes {
  const a = e.axes ?? {};
  const out: Axes = { read: clampLevel(a.read ?? 0), write: clampLevel(a.write ?? 0), code: clampLevel(a.code ?? 0) };
  if (out.read + out.write + out.code === 0) out[AXIS_OF[e.domain]] = clampLevel(e.difficulty);
  return out;
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_LEVEL, Math.max(1, Math.round(n)));
}

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

export function recencyWeight(createdAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / SCORING.recencyHalfLifeDays);
}

export function confidenceFor(evidenceCount: number): Confidence {
  if (evidenceCount < SCORING.confidence.medium) return "low";
  if (evidenceCount < SCORING.confidence.high) return "medium";
  return "high";
}

// ---- 到達レベル ----

type AxisEvidence = { level: number; success: boolean; weight: number };

/**
 * 失敗をどの系統に帰属させるか（ボトルネック）。
 * 各系統の「課題の難易度 − 現在の到達レベル」が最大の系統。同点なら全部。
 */
function bottleneckAxes(axes: Axes, levels: Record<keyof Axes, number>): (keyof Axes)[] {
  const involved = (Object.keys(axes) as (keyof Axes)[]).filter((k) => axes[k] > 0);
  if (involved.length <= 1) return involved;
  const gaps = involved.map((k) => ({ k, gap: axes[k] - levels[k] }));
  const max = Math.max(...gaps.map((g) => g.gap));
  return gaps.filter((g) => g.gap === max).map((g) => g.k);
}

function levelFromEvidence(items: AxisEvidence[]): { level: number; progress: number } {
  // 難易度 d ごとに: pos = 成功で d_S ≥ d、neg = 失敗で d_F ≤ d + window
  const rate = (d: number): { r: number; n: number } => {
    let pos = 0;
    let neg = 0;
    for (const it of items) {
      if (it.success && it.level >= d) pos += it.weight;
      else if (!it.success && it.level <= d + SCORING.failureWindow) neg += it.weight;
    }
    const n = pos + neg;
    return { r: n === 0 ? 0 : pos / n, n };
  };
  let level = 0;
  for (let d = 1; d <= MAX_LEVEL; d++) {
    const { r, n } = rate(d);
    if (n >= SCORING.minEvidence && r >= SCORING.masteryThreshold) level = d;
  }
  const next = level < MAX_LEVEL ? rate(level + 1) : { r: 1, n: 1 };
  // 次レベルの証拠が 1 件分にも満たないときは進捗を出さない（Lv0 なのに 99% と見えないように）
  const progress = level >= MAX_LEVEL ? 1 : next.n < 1 ? 0 : Math.min(0.99, next.r);
  return { level, progress };
}

/** 3 系統の到達レベルをまとめて計算する（失敗の帰属に他系統のレベルが要るため） */
export function computeLevels(events: ScorableEvent[], now: Date = new Date()): Record<keyof Axes, { level: number; progress: number }> {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const evidence = (attribute: (e: ScorableEvent, axes: Axes) => (keyof Axes)[]) => {
    const per: Record<keyof Axes, AxisEvidence[]> = { read: [], write: [], code: [] };
    for (const e of sorted) {
      const axes = axesOf(e);
      const w = recencyWeight(e.createdAt, now) * (e.success ? baseScore(true, e.hintCount) : 1);
      const targets = e.success ? (Object.keys(axes) as (keyof Axes)[]).filter((k) => axes[k] > 0) : attribute(e, axes);
      for (const k of targets) per[k].push({ level: axes[k], success: e.success, weight: w });
    }
    return {
      read: levelFromEvidence(per.read),
      write: levelFromEvidence(per.write),
      code: levelFromEvidence(per.code),
    };
  };
  // pass 1: 失敗は最も難しい系統（絶対値）に帰属 → 暫定レベル
  const pass1 = evidence((_, axes) => {
    const involved = (Object.keys(axes) as (keyof Axes)[]).filter((k) => axes[k] > 0);
    const max = Math.max(...involved.map((k) => axes[k]));
    return involved.filter((k) => axes[k] === max);
  });
  const levels1 = { read: pass1.read.level, write: pass1.write.level, code: pass1.code.level };
  // pass 2: 暫定レベルとの差が最大の系統に帰属
  return evidence((_, axes) => bottleneckAxes(axes, levels1));
}

function weightedMean(items: { value: number; weight: number }[]): number {
  let num = 0;
  let den = 0;
  for (const it of items) {
    num += it.value * it.weight;
    den += it.weight;
  }
  return den === 0 ? 0 : num / den;
}

export function computeDomainScore(domain: DomainKey, events: ScorableEvent[], now: Date = new Date()): DomainScore {
  const axis = AXIS_OF[domain];
  const own = events.filter((e) => axesOf(e)[axis] > 0);
  const levels = computeLevels(events, now)[axis];

  // subskill（観点別の証拠バー）: 主系統のイベントのタグから
  const perSkill: Record<string, { value: number; weight: number }[]> = {};
  for (const e of own) {
    const d = axesOf(e)[axis];
    const value = baseScore(e.success, e.hintCount);
    const weight = difficultyWeight(d) * recencyWeight(e.createdAt, now);
    for (const tag of e.skillTags.filter((t) => SUBSKILLS[domain].includes(t))) (perSkill[tag] ??= []).push({ value, weight });
  }
  const subskills: Record<string, number> = {};
  for (const skill of SUBSKILLS[domain]) {
    const items = perSkill[skill];
    if (items && items.length > 0) subskills[skill] = Math.round(weightedMean(items) * 100);
  }

  const evidenceCount = own.length;
  const score = evidenceCount === 0 ? 0 : Math.min(100, Math.round(levels.level * 10 + levels.progress * 10));
  const successRate = evidenceCount === 0 ? 0 : own.filter((e) => e.success).length / evidenceCount;
  const avgHints = evidenceCount === 0 ? 0 : own.reduce((a, e) => a + e.hintCount, 0) / evidenceCount;
  const avgDifficulty = evidenceCount === 0 ? 0 : own.reduce((a, e) => a + axesOf(e)[axis], 0) / evidenceCount;

  return {
    domain,
    score,
    level: levels.level,
    progress: levels.progress,
    subskills,
    evidenceCount,
    confidence: confidenceFor(evidenceCount),
    successRate,
    avgHints,
    avgDifficulty,
  };
}

/** 次に出す難易度（1..10）: 到達レベル + 1 を基本に、直近の失敗が続けば据え置く */
export function recommendDifficulty(domain: DomainKey, events: ScorableEvent[], now: Date = new Date()): number {
  const axis = AXIS_OF[domain];
  const own = events.filter((e) => axesOf(e)[axis] > 0);
  if (own.length === 0) return 3;
  const { level } = computeLevels(events, now)[axis];
  const recent = [...own].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 3);
  const recentFails = recent.filter((e) => !e.success).length;
  const target = recentFails >= 2 ? Math.max(1, level) : level + 1;
  return Math.min(MAX_LEVEL, Math.max(1, target));
}

export function allDomainScores(events: ScorableEvent[], now: Date = new Date()): Record<DomainKey, DomainScore> {
  return Object.fromEntries(DOMAINS.map((d) => [d, computeDomainScore(d, events, now)])) as Record<DomainKey, DomainScore>;
}
