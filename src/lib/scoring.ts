// 能力スコアの決定論的集計（数値 = evidence）
// LLMはここに関与しない。learning_events から subskill ごとに重み付き平均を出す。
//
//   base:   hintなし成功 1.0 / hint1回 0.8 / hint2回 0.6 / hint3回以上 0.5 / 失敗 0.2
//   weight: difficulty weighting × recency weighting
//   事前分布: 中立値 0.5 を擬似観測 PRIOR_WEIGHT 件分だけ混ぜ、
//            一回の失敗だけで「苦手」と断定されないようにする。

import { type Confidence, type DomainKey, SUBSKILLS } from "./domain";

export type ScorableEvent = {
  domain: DomainKey;
  difficulty: number; // 1..5
  success: boolean;
  hintCount: number;
  skillTags: string[];
  createdAt: Date;
};

export type DomainScore = {
  domain: DomainKey;
  score: number; // 0..100
  subskills: Record<string, number>; // 0..100（evidenceが無いsubskillは含めない）
  evidenceCount: number;
  confidence: Confidence;
  successRate: number; // 0..1
  avgHints: number;
  avgDifficulty: number;
};

const PRIOR_WEIGHT = 2;
const PRIOR_VALUE = 0.5;
const RECENCY_HALF_LIFE_DAYS = 14;

export function baseScore(success: boolean, hintCount: number): number {
  if (!success) return 0.2;
  if (hintCount <= 0) return 1.0;
  if (hintCount === 1) return 0.8;
  if (hintCount === 2) return 0.6;
  return 0.5;
}

export function difficultyWeight(difficulty: number): number {
  const d = Math.min(5, Math.max(1, difficulty));
  // 1 → 0.7, 3 → 1.0, 5 → 1.3
  return 0.7 + (d - 1) * 0.15;
}

export function recencyWeight(createdAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

export function confidenceFor(evidenceCount: number): Confidence {
  if (evidenceCount < 3) return "low";
  if (evidenceCount < 8) return "medium";
  return "high";
}

function weightedMean(items: { value: number; weight: number }[]): number {
  let num = PRIOR_VALUE * PRIOR_WEIGHT;
  let den = PRIOR_WEIGHT;
  for (const it of items) {
    num += it.value * it.weight;
    den += it.weight;
  }
  return den === 0 ? PRIOR_VALUE : num / den;
}

export function computeDomainScore(
  domain: DomainKey,
  events: ScorableEvent[],
  now: Date = new Date(),
): DomainScore {
  const own = events.filter((e) => e.domain === domain);
  const perSkill: Record<string, { value: number; weight: number }[]> = {};
  const overall: { value: number; weight: number }[] = [];

  for (const e of own) {
    const value = baseScore(e.success, e.hintCount);
    const weight = difficultyWeight(e.difficulty) * recencyWeight(e.createdAt, now);
    overall.push({ value, weight });
    const tags = e.skillTags.filter((t) => SUBSKILLS[domain].includes(t));
    for (const tag of tags) {
      (perSkill[tag] ??= []).push({ value, weight });
    }
  }

  const subskills: Record<string, number> = {};
  for (const skill of SUBSKILLS[domain]) {
    const items = perSkill[skill];
    if (items && items.length > 0) {
      subskills[skill] = Math.round(weightedMean(items) * 100);
    }
  }

  const evidenceCount = own.length;
  const score = evidenceCount === 0 ? 0 : Math.round(weightedMean(overall) * 100);
  const successRate = evidenceCount === 0 ? 0 : own.filter((e) => e.success).length / evidenceCount;
  const avgHints = evidenceCount === 0 ? 0 : own.reduce((a, e) => a + e.hintCount, 0) / evidenceCount;
  const avgDifficulty =
    evidenceCount === 0 ? 0 : own.reduce((a, e) => a + e.difficulty, 0) / evidenceCount;

  return {
    domain,
    score,
    subskills,
    evidenceCount,
    confidence: confidenceFor(evidenceCount),
    successRate,
    avgHints,
    avgDifficulty,
  };
}

// 次に出す難易度の目安（決定論）。直近の成績で 1..5 の範囲を上下させる。
export function recommendDifficulty(domain: DomainKey, events: ScorableEvent[]): number {
  const recent = events
    .filter((e) => e.domain === domain)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5);
  if (recent.length === 0) return 2;
  const last = recent[0];
  let d = last.difficulty;
  const recentSuccess = recent.filter((e) => e.success && e.hintCount <= 1).length;
  if (recentSuccess >= 3 && d < 5) d += 1;
  else if (recent.filter((e) => !e.success).length >= 2 && d > 1) d -= 1;
  return Math.min(5, Math.max(1, d));
}
