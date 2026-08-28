// 能力スコアの決定論的集計（数値 = evidence）。LLM はここに関与しない。
// 重み・難易度ベクトルなどの土台は scoring.core.ts、ここは「到達レベルの判定」「スコア」「推薦難易度」。
//
// モデル（src/config/trivium.config.ts の SCORING で調整）:
//   - 難易度は系統ごとに 1〜10。各課題は難易度ベクトル { read, write, code }（0 = 無関係）を持つ
//   - 成功は関与する全系統に「その難易度以下は解ける」証拠を与える
//   - 失敗は「相対的に最も難しかった系統（ボトルネック）」だけに、その難易度付近の否定証拠を与える
//   - 到達レベル L = 「難易度 d 以上の正答率が threshold 以上」を満たす最大の d（それ未満は 100% とみなす）
//   - 表示スコア（0〜100、小数 1 桁）= L×10 + 次のレベルへの進捗×10
//     進捗は「次のレベル帯の証拠量（minEvidence に対する割合）× 正答率（threshold に対する割合）」で連続的に増える
//   - subskill（観点別 0〜100）は従来どおり基礎点×難易度×新しさの重み付き平均（証拠バー用）
import { SCORING } from "@/config/trivium.config";
import { type DomainKey, DOMAINS, SUBSKILLS } from "./domain";
import { unitOf } from "./hash";
import {
  AXIS_OF,
  MAX_LEVEL,
  axesOf,
  baseScore,
  clampDifficulty,
  confidenceFor,
  difficultyWeight,
  recencyWeight,
  round1,
  weightedMean,
  type Axes,
  type DomainScore,
  type ScorableEvent,
} from "./scoring.core";

export type { Axes, DomainScore, ScorableEvent } from "./scoring.core";
export {
  AXIS_OF,
  DOMAIN_OF_AXIS,
  MAX_LEVEL,
  axesOf,
  baseScore,
  clampDifficulty,
  confidenceFor,
  difficultyWeight,
  formatScore,
  recencyWeight,
  round1,
} from "./scoring.core";

// ---- 到達レベル ----

type AxisEvidence = { level: number; success: boolean; weight: number };

/**
 * 降格のしきい値。到達済みのレベルは、その帯の正答率がこれを下回るまで維持する（ヒステリシス）。
 * 昇格は SCORING.masteryThreshold（0.7）なので、2 勝 1 敗（0.667）でレベルが落ちることはない。
 */
export const DEMOTION_THRESHOLD = 0.5;

/**
 * 失敗をどの系統に帰属させるか（ボトルネック）。
 * 各系統の「課題の難易度 − 現在の到達レベル」が最大の系統。同点なら主系統（課題の domain）、
 * 主系統が同点に含まれなければ難易度が最も高い系統、の 1 軸に絞る（複合課題の失敗が両軸を同時に落とさないように）。
 */
function bottleneckAxis(axes: Axes, levels: Record<keyof Axes, number>, primary: keyof Axes): (keyof Axes)[] {
  const involved = (Object.keys(axes) as (keyof Axes)[]).filter((k) => axes[k] > 0);
  if (involved.length <= 1) return involved;
  const gaps = involved.map((k) => ({ k, gap: axes[k] - levels[k] }));
  const max = Math.max(...gaps.map((g) => g.gap));
  const tied = gaps.filter((g) => g.gap === max).map((g) => g.k);
  if (tied.length === 1) return tied;
  if (tied.includes(primary)) return [primary];
  return [tied.sort((a, b) => axes[b] - axes[a])[0]];
}

/**
 * 難易度 d の帯の正答率。pos = 成功で d_S ≥ d、neg = 失敗で d_F ≤ d（否定証拠は上方向にだけ効く。
 * 難易度 4 の失敗は「3 以下は解ける」という判定を傷つけない）。
 *   r: 新しさ重み付きの正答率 / n: 重み付き証拠量（進捗用） / count: 減衰前の件数（レベル判定用。時間経過だけで到達レベルが消えない）
 */
function bandRate(items: AxisEvidence[], d: number): { r: number; n: number; count: number } {
  let pos = 0;
  let neg = 0;
  let count = 0;
  for (const it of items) {
    if (it.success && it.level >= d) {
      pos += it.weight;
      count++;
    } else if (!it.success && it.level <= d) {
      neg += it.weight;
      count++;
    }
  }
  const n = pos + neg;
  return { r: n === 0 ? 0 : pos / n, n, count };
}

/** 昇格ルール: 件数 ≥ minEvidence かつ正答率 ≥ masteryThreshold を満たす最大の d */
function masteredLevel(items: AxisEvidence[]): number {
  let level = 0;
  for (let d = 1; d <= MAX_LEVEL; d++) {
    const { r, count } = bandRate(items, d);
    if (count >= SCORING.minEvidence && r >= SCORING.masteryThreshold) level = d;
  }
  return level;
}

/**
 * 到達レベルと進捗。items は時系列順。
 * 昇格は masteryThreshold で判定し、いったん到達したレベルは帯の正答率が DEMOTION_THRESHOLD を下回るまで維持する
 * （1 回の失敗で 1〜2 段落ちないようにする）。
 */
function levelFromEvidence(items: AxisEvidence[]): { level: number; progress: number } {
  let level = 0;
  for (let i = 1; i <= items.length; i++) {
    const prefix = items.slice(0, i);
    const cand = masteredLevel(prefix);
    if (cand >= level) {
      level = cand;
      continue;
    }
    // 降格判定: 既到達レベルから下へ、維持できる（正答率 ≥ DEMOTION_THRESHOLD）最大の帯を探す
    let keep = 0;
    for (let d = level; d >= 1; d--) {
      const { r, count } = bandRate(prefix, d);
      // 浮動小数の誤差で「ちょうど 0.5」が割れないよう、わずかな余裕を持たせる
      if (count >= SCORING.minEvidence && r + 1e-9 >= DEMOTION_THRESHOLD) {
        keep = d;
        break;
      }
    }
    level = Math.max(cand, keep);
  }
  if (level >= MAX_LEVEL) return { level, progress: 1 };
  // 次のレベルへの進捗（連続値）: 証拠量が minEvidence に近づくほど、正答率が threshold に近づくほど滑らかに上がる。
  // 1 問正解（重み 1.0）で約 67%、ヒントありの正解ならその分低く、失敗が混じれば正答率の分だけ下がる。
  // レベル判定を満たした瞬間に level が上がるので、progress は 0.99 で頭打ちにする
  const next = bandRate(items, level + 1);
  const evidence = Math.min(1, next.n / SCORING.minEvidence);
  const mastery = Math.min(1, next.r / SCORING.masteryThreshold);
  const progress = Math.min(0.99, evidence * mastery);
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
  // pass 1: 失敗は最も難しい系統（絶対値。同点なら主系統）に帰属 → 暫定レベル
  const pass1 = evidence((e, axes) => {
    const involved = (Object.keys(axes) as (keyof Axes)[]).filter((k) => axes[k] > 0);
    const max = Math.max(...involved.map((k) => axes[k]));
    const tied = involved.filter((k) => axes[k] === max);
    return tied.includes(AXIS_OF[e.domain]) ? [AXIS_OF[e.domain]] : tied.slice(0, 1);
  });
  const levels1 = { read: pass1.read.level, write: pass1.write.level, code: pass1.code.level };
  // pass 2: 暫定レベルとの差が最大の系統（1 軸）に帰属
  return evidence((e, axes) => bottleneckAxis(axes, levels1, AXIS_OF[e.domain]));
}

// ---- 系統ごとのスコア ----

/** subskill（観点別の証拠バー 0..100）。主系統のイベントのタグから重み付き平均で出す */
function subskillScores(domain: DomainKey, own: ScorableEvent[], axis: keyof Axes, now: Date): Record<string, number> {
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
  return subskills;
}

export function computeDomainScore(domain: DomainKey, events: ScorableEvent[], now: Date = new Date()): DomainScore {
  const axis = AXIS_OF[domain];
  const own = events.filter((e) => axesOf(e)[axis] > 0);
  const levels = computeLevels(events, now)[axis];
  const subskills = subskillScores(domain, own, axis, now);

  const evidenceCount = own.length;
  const score = evidenceCount === 0 ? 0 : Math.min(100, round1(levels.level * 10 + levels.progress * 10));
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

export function allDomainScores(events: ScorableEvent[], now: Date = new Date()): Record<DomainKey, DomainScore> {
  return Object.fromEntries(DOMAINS.map((d) => [d, computeDomainScore(d, events, now)])) as Record<DomainKey, DomainScore>;
}

// ---- 次に出す難易度 ----

/** 履歴が無いときの推薦難易度。最初は低めから始め、正解ごとに 1 つずつ上がる */
export const INITIAL_DIFFICULTY = 2;

/** 文字列 → [0,1) の決定論的な擬似乱数（FNV-1a。出題のゆらぎ用で暗号用途ではない） */
export function seededUnit(seed: string): number {
  return unitOf(seed);
}

/**
 * 推薦難易度に「ゆらぎ」を加えた実際の出題難易度。
 * 証拠（その系統の回答数）が少ないうちは広め（-1〜+2）にばらつかせて探索し、増えるほど推薦値の周辺に収束する。
 * seed は (userId, domain, 回答数) から作るので、同じ状態では同じ値（「次」を連打しても変わらない・テスト可能）。
 */
export function adaptiveTarget(recommended: number, evidenceCount: number, seed: string): number {
  const u = seededUnit(seed);
  // [offset, 累積確率]
  const table: [number, number][] =
    evidenceCount <= 2
      ? [[-1, 0.2], [0, 0.55], [1, 0.85], [2, 1]]
      : evidenceCount <= 6
        ? [[-1, 0.25], [0, 0.75], [1, 1]]
        : [[-1, 0.12], [0, 0.88], [1, 1]];
  const offset = table.find(([, p]) => u < p)?.[0] ?? 0;
  return clampDifficulty(recommended + offset);
}

/**
 * 次に出す難易度（1..10）。
 *   基本: 到達レベル + 1。直近 3 件中 2 件失敗なら到達レベルに据え置く。
 *   証拠が少なくレベルがまだ付かない間は直近の結果を優先する（初回の正解で 3 → 1 に落ちない）:
 *     直近が成功（ヒントなし）→ その難易度 + 1 以上 / ヒントあり成功 → その難易度以上 /
 *     失敗 1 回 → 直近の成功難易度で据え置き / 直近 3 件に成功が無ければ 失敗した難易度 − 失敗回数
 */
export function recommendDifficulty(domain: DomainKey, events: ScorableEvent[], now: Date = new Date()): number {
  const axis = AXIS_OF[domain];
  const own = events.filter((e) => axesOf(e)[axis] > 0);
  if (own.length === 0) return INITIAL_DIFFICULTY;
  const { level } = computeLevels(events, now)[axis];
  const recent = [...own].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 3);
  const recentFails = recent.filter((e) => !e.success).length;
  let target = recentFails >= 2 ? Math.max(1, level) : level + 1;
  const latest = recent[0];
  const lastSuccess = recent.find((e) => e.success);
  if (lastSuccess) {
    const d = axesOf(lastSuccess)[axis];
    const floor = latest.success ? d + (latest.hintCount === 0 ? 1 : 0) : recentFails >= 2 ? d - 1 : d;
    target = Math.max(target, floor);
  } else if (latest && !latest.success) {
    target = Math.max(target, axesOf(latest)[axis] - recentFails);
  }
  return clampDifficulty(target);
}
