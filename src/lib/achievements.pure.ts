// achievement の解除判定（純粋関数・決定論）。events から毎回計算するので DB の状態に依存しない。
// server-only を付けない（テストから直接呼ぶ）。保存は src/lib/achievements.ts。
import { XP } from "@/config/trivium.config";
import { ACHIEVEMENTS } from "./achievement-defs";
import { DOMAINS, type DomainKey } from "./domain";
import { axesOf, computeLevels, type ScorableEvent } from "./scoring";
import { computeXp, dayKey, rankFor } from "./xp";

export type AchievementEvent = ScorableEvent & {
  taskId: string;
  /** LLM が作った課題か */
  generated?: boolean;
};

const AXIS: Record<DomainKey, "read" | "write" | "code"> = { READ: "read", WRITE: "write", CODE: "code" };

/** JST の時刻（0..23）と曜日（0=日） */
function localParts(d: Date): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: XP.timezone, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return { hour, weekday: weekday < 0 ? 1 : weekday };
}

/** "YYYY-MM-DD" の並びから最長の連続日数 */
export function longestRun(dayKeys: string[]): number {
  const days = [...new Set(dayKeys)].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const k of days) {
    const t = Date.parse(`${k}T00:00:00Z`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    prev = t;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * 解除されている achievement の key を返す（順序は ACHIEVEMENTS の定義順）。
 * 判定はすべて events からの決定論。閾値は説明文（achievement-defs）と一致させる。
 */
export function unlockedAchievements(events: AchievementEvent[], now: Date = new Date()): string[] {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const has = new Set<string>();
  if (sorted.length === 0) return [];

  const successes = sorted.filter((e) => e.success);
  const involved = (e: ScorableEvent): DomainKey[] => {
    const a = axesOf(e);
    return DOMAINS.filter((d) => a[AXIS[d]] > 0);
  };

  // ---- はじめの一歩 ----
  has.add("first_step");
  if (successes.some((e) => involved(e).includes("READ"))) has.add("first_read");
  if (successes.some((e) => involved(e).includes("WRITE"))) has.add("first_write");
  if (successes.some((e) => involved(e).includes("CODE"))) has.add("first_logic");
  if (successes.some((e) => e.hintCount === 0)) has.add("no_hint");
  if (successes.some((e) => e.hintCount >= 1)) has.add("comeback");
  if (DOMAINS.every((d) => sorted.some((e) => involved(e).includes(d)))) has.add("trivium");

  // ---- ミッション・連続 ----
  const xp = computeXp(sorted, now);
  if (xp.missionDays.length >= 1) has.add("mission_first");
  if (xp.missionDays.length >= 10) has.add("missions_10");
  if (xp.missionDays.length >= 30) has.add("missions_30");
  const run = longestRun(xp.missionDays);
  if (run >= 3) has.add("streak_3");
  if (run >= 7) has.add("streak_7");
  if (run >= 14) has.add("streak_14");
  if (run >= 30) has.add("streak_30");

  // ---- 積み上げ ----
  const n = sorted.length;
  if (n >= 10) has.add("ten_events");
  if (n >= 30) has.add("thirty_events");
  if (n >= 100) has.add("hundred_events");
  if (n >= 300) has.add("three_hundred_events");
  const count = (d: DomainKey) => sorted.filter((e) => involved(e).includes(d)).length;
  if (count("READ") >= 20) has.add("read_20");
  if (count("WRITE") >= 20) has.add("write_20");
  if (count("CODE") >= 20) has.add("logic_20");

  // ---- 到達レベル ----
  const levels = computeLevels(sorted, now);
  for (const d of DOMAINS) {
    const lv = levels[AXIS[d]].level;
    for (const t of [3, 5, 8, 10]) if (lv >= t) has.add(`${d.toLowerCase()}_lv${t}`);
  }
  if (DOMAINS.every((d) => levels[AXIS[d]].level >= 5)) has.add("balanced_5");
  if (DOMAINS.every((d) => levels[AXIS[d]].level >= 8)) has.add("balanced_8");

  // ---- XP・ランク ----
  for (const t of [100, 500, 1000, 3000]) if (xp.total >= t) has.add(`xp_${t}`);
  const rankOrder = ["NOVICE", "APPRENTICE", "GRAMMARIAN", "LOGICIAN", "RHETOR", "MASTER"];
  const reached = rankOrder.indexOf(rankFor(xp.total).short);
  const rankKeys: Record<string, string> = { APPRENTICE: "rank_apprentice", GRAMMARIAN: "rank_grammarian", LOGICIAN: "rank_logician", RHETOR: "rank_rhetor", MASTER: "rank_master" };
  for (const [short, key] of Object.entries(rankKeys)) if (reached >= rankOrder.indexOf(short)) has.add(key);

  // ---- 腕前 ----
  let streakNoHint = 0;
  let bestNoHint = 0;
  for (const e of sorted) {
    streakNoHint = e.success && e.hintCount === 0 ? streakNoHint + 1 : 0;
    bestNoHint = Math.max(bestNoHint, streakNoHint);
  }
  if (bestNoHint >= 5) has.add("no_hint_5");
  if (bestNoHint >= 10) has.add("no_hint_10");
  const maxAxis = (e: ScorableEvent) => {
    const a = axesOf(e);
    return Math.max(a.read, a.write, a.code);
  };
  if (successes.some((e) => maxAxis(e) >= 7)) has.add("hard_clear");
  if (successes.some((e) => maxAxis(e) >= 9)) has.add("expert_clear");
  if (successes.some((e) => maxAxis(e) >= 10)) has.add("summit");
  const failedTasks = new Set<string>();
  for (const e of sorted) {
    if (e.success && failedTasks.has(e.taskId)) has.add("revenge");
    if (!e.success) failedTasks.add(e.taskId);
  }
  // 日ごとの集計（JST）
  const byDay = new Map<string, AchievementEvent[]>();
  for (const e of sorted) {
    const k = dayKey(e.createdAt);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  for (const list of byDay.values()) {
    if (list.length >= 3 && list.every((e) => e.success)) has.add("flawless_day");
    const okDomains = new Set(list.filter((e) => e.success).flatMap(involved));
    if (DOMAINS.every((d) => okDomains.has(d))) has.add("perfect_mission");
    if (list.length >= 5) has.add("five_a_day");
    if (list.length >= 10) has.add("ten_a_day");
  }

  // ---- 習慣 ----
  for (const e of sorted) {
    const { hour, weekday } = localParts(e.createdAt);
    if (hour >= 6 && hour < 9) has.add("early_bird");
    if (hour >= 23 || hour < 4) has.add("night_owl");
    if (weekday === 0 || weekday === 6) has.add("weekend_learner");
  }

  // ---- スペシャル ----
  const gen = successes.filter((e) => e.generated);
  if (gen.length >= 1) has.add("generated_clear");
  if (gen.length >= 5) has.add("generated_5");
  const comp = successes.filter((e) => involved(e).length >= 2);
  if (comp.length >= 1) has.add("composite_clear");
  if (comp.length >= 3) has.add("composite_3");

  return Object.keys(ACHIEVEMENTS).filter((k) => has.has(k));
}
