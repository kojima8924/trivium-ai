// Dashboard の時系列データ（スコアの推移・実績のタイムライン）の取得。
// 数値は ProfileSnapshot（決着ごとに service.ts の snapshot() が 1 行書く）をそのまま読むだけで、
// ここでは再計算しない（Dashboard 本体の live 集計と二重管理にしないため）。
import "server-only";
import { prisma } from "./prisma";
import { foldDailyTrend, markersOnTrend, toAchievementTimeline, type TimelineItem, type TrendMarker, type TrendPoint } from "./history.pure";

export type { TimelineItem, TrendMarker, TrendPoint };

export type HistoryData = {
  trend: TrendPoint[];
  achievements: TimelineItem[];
  markers: TrendMarker[];
};

/** 直近 days 日のスコア推移（JST の日ごと・その日の最後の値） */
export async function loadScoreTrend(userId: string, days = 30): Promise<TrendPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.profileSnapshot.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { read: true, write: true, code: true, createdAt: true },
  });
  return foldDailyTrend(rows);
}

/** 実績の解除履歴（新しい順） */
export async function loadAchievementTimeline(userId: string, limit = 20): Promise<TimelineItem[]> {
  const rows = await prisma.achievement.findMany({
    where: { userId },
    orderBy: { unlockedAt: "desc" },
    take: limit,
    select: { key: true, unlockedAt: true },
  });
  return toAchievementTimeline(rows, limit);
}

/** グラフ＋タイムラインを 1 回で（Dashboard から呼ぶ。失敗しても Dashboard は出したいので呼び側で catch する） */
export async function loadHistory(userId: string, days = 30, limit = 20): Promise<HistoryData> {
  const [trend, achievements] = await Promise.all([loadScoreTrend(userId, days), loadAchievementTimeline(userId, limit)]);
  return { trend, achievements, markers: markersOnTrend(trend, achievements) };
}
