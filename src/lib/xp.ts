// XP・デイリーミッション・連続日数・ランク（ゲーミフィケーション）。
// 能力の三角形（証拠）とは別の「行動の積み上げ」指標。すべて learning_events から決定論で導く。
// 係数は src/config/trivium.config.ts の XP で調整する。
import { XP } from "@/config/trivium.config";
import { DOMAINS, type DomainKey } from "./domain";
import { axesOf, type ScorableEvent } from "./scoring";

export type XpEvent = ScorableEvent & { generated?: boolean };

export type XpSummary = {
  total: number;
  byDomain: Record<DomainKey, number>;
  /** ミッション達成日（YYYY-MM-DD, JST） */
  missionDays: string[];
  /** 今日ミッション達成済みか */
  missionToday: boolean;
  /** 今日の各系統の取り組み状況 */
  today: Record<DomainKey, boolean>;
  streak: number;
  rank: { title: string; short: string; min: number; next: number | null; progress: number };
  /** 内訳（表示用） */
  breakdown: { tasks: number; missions: number; streak: number };
};

/** JST の日付キー */
export function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: XP.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** 1 イベントの XP と系統別の内訳 */
export function xpForEvent(e: XpEvent): { total: number; byDomain: Record<DomainKey, number> } {
  const axes = axesOf(e);
  const sum = axes.read + axes.write + axes.code;
  const base = XP.perDifficultyPoint * sum;
  const mult = e.success ? XP.hintMultiplier[Math.min(e.hintCount, XP.hintMultiplier.length - 1)] : XP.failureMultiplier;
  const gen = e.generated ? XP.generatedTaskMultiplier : 1;
  const total = Math.round(base * mult * gen);
  const byDomain: Record<DomainKey, number> = { READ: 0, WRITE: 0, CODE: 0 };
  if (sum > 0) {
    // 関与する系統に難易度比で按分し、端数は「関与する系統のうち最も難易度が高いもの」に寄せる
    // （無関係な系統に負の XP が入らないようにする）
    const shares: { d: DomainKey; v: number }[] = [
      { d: "READ", v: axes.read },
      { d: "WRITE", v: axes.write },
      { d: "CODE", v: axes.code },
    ];
    let assigned = 0;
    for (const s of shares) {
      byDomain[s.d] = s.v > 0 ? Math.floor((total * s.v) / sum) : 0;
      assigned += byDomain[s.d];
    }
    const top = shares.filter((s) => s.v > 0).sort((a, b) => b.v - a.v)[0];
    if (top) byDomain[top.d] += total - assigned;
  }
  return { total, byDomain };
}

/** その日に 3 系統すべてに決着した記録があるか */
function missionDaysOf(events: XpEvent[]): string[] {
  const byDay = new Map<string, Set<DomainKey>>();
  for (const e of events) {
    const k = dayKey(e.createdAt);
    const set = byDay.get(k) ?? new Set<DomainKey>();
    const axes = axesOf(e);
    if (axes.read > 0) set.add("READ");
    if (axes.write > 0) set.add("WRITE");
    if (axes.code > 0) set.add("CODE");
    byDay.set(k, set);
  }
  return [...byDay.entries()].filter(([, s]) => DOMAINS.every((d) => s.has(d))).map(([k]) => k).sort();
}

/** 今日から遡って連続でミッション達成している日数（今日未達なら昨日から数える） */
export function streakOf(missionDays: string[], now: Date): number {
  const set = new Set(missionDays);
  let streak = 0;
  const cursor = new Date(now);
  if (!set.has(dayKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (set.has(dayKey(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/** これまでで最長のミッション連続日数（now に依存しない。XP の連続ボーナスは減らない指標として扱う） */
export function longestStreak(missionDays: string[]): number {
  const set = new Set(missionDays);
  let best = 0;
  for (const day of set) {
    const prev = new Date(`${day}T00:00:00+09:00`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    if (set.has(dayKey(prev))) continue; // 連続の先頭だけから数える
    let run = 0;
    const cursor = new Date(`${day}T00:00:00+09:00`);
    while (set.has(dayKey(cursor))) {
      run++;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    best = Math.max(best, run);
  }
  return best;
}

export function rankFor(total: number): XpSummary["rank"] {
  const ranks = [...XP.ranks].sort((a, b) => b.min - a.min);
  const idx = ranks.findIndex((r) => total >= r.min);
  const r = ranks[idx === -1 ? ranks.length - 1 : idx];
  const higher = ranks[(idx === -1 ? ranks.length - 1 : idx) - 1];
  const next = higher ? higher.min : null;
  const progress = next === null ? 1 : Math.min(1, (total - r.min) / Math.max(1, next - r.min));
  return { title: r.title, short: r.short, min: r.min, next, progress };
}

export function computeXp(events: XpEvent[], now: Date = new Date()): XpSummary {
  const byDomain: Record<DomainKey, number> = { READ: 0, WRITE: 0, CODE: 0 };
  let tasks = 0;
  for (const e of events) {
    const x = xpForEvent(e);
    tasks += x.total;
    for (const d of DOMAINS) byDomain[d] += x.byDomain[d];
  }
  const missionDays = missionDaysOf(events);
  const missions = missionDays.length * XP.dailyMissionBonus;
  const streak = streakOf(missionDays, now);
  // 連続ボーナスは「これまでの最長連続」で確定させる（今日未達で streak が途切れても合計・ランクが減らない）
  const streakBonus = Math.min(XP.streakBonusMax, longestStreak(missionDays) * XP.streakBonusPerDay);
  const total = tasks + missions + streakBonus;

  const todayKey = dayKey(now);
  const today: Record<DomainKey, boolean> = { READ: false, WRITE: false, CODE: false };
  for (const e of events) {
    if (dayKey(e.createdAt) !== todayKey) continue;
    const axes = axesOf(e);
    if (axes.read > 0) today.READ = true;
    if (axes.write > 0) today.WRITE = true;
    if (axes.code > 0) today.CODE = true;
  }

  return {
    total,
    byDomain,
    missionDays,
    missionToday: missionDays.includes(todayKey),
    today,
    streak,
    rank: rankFor(total),
    breakdown: { tasks, missions, streak: streakBonus },
  };
}

export type XpBreakdown = {
  /** この決着で増えた XP（課題 + ミッション + 連続） */
  gained: number;
  task: number;
  missionBonus: number;
  streakBonus: number;
  missionJustDone: boolean;
  total: number;
  rank: string;
};

/**
 * 1 件の決着で増えた XP の内訳（決定論）。before = その決着を除いた events、after = 含めた events。
 * Web の結果カードと LINE の push はこれだけを整形して表示する（計算を二重に持たない）。
 */
export function xpBreakdown(before: XpEvent[], after: XpEvent[], now: Date = new Date()): XpBreakdown {
  const xb = computeXp(before, now);
  const xa = computeXp(after, now);
  const last = after[after.length - 1];
  const task = last ? xpForEvent(last).total : 0;
  const missionJustDone = xa.missionToday && !xb.missionToday;
  const missionBonus = Math.max(0, xa.breakdown.missions - xb.breakdown.missions);
  const streakBonus = Math.max(0, xa.breakdown.streak - xb.breakdown.streak);
  return {
    gained: Math.max(0, xa.total - xb.total),
    task,
    missionBonus,
    streakBonus,
    missionJustDone,
    total: xa.total,
    rank: xa.rank.title,
  };
}
