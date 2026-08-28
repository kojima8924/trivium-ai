// Dashboard の時系列表示（スコアの推移・実績のタイムライン）の整形。
// DB に触らない純粋関数だけを置く（server-only を付けない＝テストから直接呼べる）。
// 日付は JST で畳む（xp.ts の dayKey と同じ基準）。欠損日は補間しない（無い日は点を打たない）。
import { XP } from "@/config/trivium.config";
import { ACHIEVEMENTS, type AchievementTier } from "@/lib/achievement-defs";

/** JST の日付キー（YYYY-MM-DD）。xp.ts の dayKey と同じ規則 */
export function jstDayKey(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: XP.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** 「08/28」形式の短いラベル（横軸用） */
export function shortLabel(dayKey: string): string {
  const [, m, d] = dayKey.split("-");
  return `${m}/${d}`;
}

export type SnapshotRow = { read: number; write: number; code: number; createdAt: Date };

export type TrendPoint = {
  /** JST の日付キー（YYYY-MM-DD） */
  day: string;
  /** 横軸ラベル（MM/DD） */
  label: string;
  read: number;
  write: number;
  code: number;
};

/**
 * スナップショットを JST の日ごとに畳む。同じ日に複数あればその日の**最後の値**を採用する。
 * 入力の並び順は問わない（内部で時刻順に並べ替える）。
 */
export function foldDailyTrend(rows: SnapshotRow[]): TrendPoint[] {
  const byDay = new Map<string, TrendPoint>();
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const r of sorted) {
    const day = jstDayKey(r.createdAt);
    byDay.set(day, { day, label: shortLabel(day), read: round1(r.read), write: round1(r.write), code: round1(r.code) });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export type AchievementRow = { key: string; unlockedAt: Date };

export type TimelineItem = {
  key: string;
  title: string;
  description: string;
  emoji: string;
  tier: AchievementTier;
  /** ISO 文字列（表示側で日付に整形する） */
  unlockedAt: string;
  /** JST の日付キー。グラフ上のマーカー位置に使う */
  day: string;
};

/** 実績を新しい順に整形する。定義が無いキーは 🏅 とキー名で出す（消さない） */
export function toAchievementTimeline(rows: AchievementRow[], limit = 20): TimelineItem[] {
  return [...rows]
    .sort((a, b) => b.unlockedAt.getTime() - a.unlockedAt.getTime())
    .slice(0, limit)
    .map((r) => {
      const def = ACHIEVEMENTS[r.key];
      return {
        key: r.key,
        title: def?.title ?? r.key,
        description: def?.description ?? "",
        emoji: def?.emoji ?? "🏅",
        tier: def?.tier ?? "bronze",
        unlockedAt: r.unlockedAt.toISOString(),
        day: jstDayKey(r.unlockedAt),
      };
    });
}

/**
 * グラフに載せる実績マーカー。トレンドに存在する日付のものだけを残し、
 * 同じ日に複数あれば 1 点にまとめる（件数を持たせて「🏅×2」と出せるように）。
 */
export type TrendMarker = { day: string; label: string; count: number; titles: string[] };

export function markersOnTrend(trend: TrendPoint[], items: TimelineItem[]): TrendMarker[] {
  const days = new Map(trend.map((p) => [p.day, p.label]));
  const byDay = new Map<string, TrendMarker>();
  for (const it of items) {
    const label = days.get(it.day);
    if (!label) continue;
    const cur = byDay.get(it.day);
    if (cur) {
      cur.count += 1;
      cur.titles.push(it.title);
    } else {
      byDay.set(it.day, { day: it.day, label, count: 1, titles: [it.title] });
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
