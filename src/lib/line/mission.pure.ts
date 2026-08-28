// デイリーミッション（1 日 3 問: READ / WRITE / LOGIC を 1 問ずつ）の表示（純粋関数）。
// 集計そのものは computeXp の today / missionToday を使う。ここは「LINE に出す 1 行」に整えるだけ。
import { DOMAIN_META, DOMAINS, type DomainKey } from "@/lib/domain";

/** 今日の達成状況（computeXp().today と同じ形） */
export type TodayProgress = Record<DomainKey, boolean>;

/** 残りの系統（未着手のもの） */
export function remainingDomains(today: TodayProgress): DomainKey[] {
  return DOMAINS.filter((d) => !today[d]);
}

/**
 * 「今日のミッション: READ ✓ / WRITE − / LOGIC ✓（あと 1 問）」の 1 行。
 * 3 系統そろっていれば「🎉 今日のミッション達成」。
 */
export function missionLine(today: TodayProgress): string {
  const marks = DOMAINS.map((d) => `${DOMAIN_META[d].label} ${today[d] ? "✓" : "−"}`).join(" / ");
  const rest = remainingDomains(today);
  if (rest.length === 0) return `🎉 今日のミッション達成（${marks}）`;
  return `今日のミッション: ${marks}（あと ${rest.length} 問: ${rest.map((d) => DOMAIN_META[d].label).join("・")}）`;
}
