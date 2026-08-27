// achievement の保存（判定は achievements.pure.ts の決定論ロジック）
import "server-only";
import { prisma } from "./prisma";
import { unlockedAchievements, type AchievementEvent } from "./achievements.pure";

export { ACHIEVEMENTS } from "./achievement-defs";

/**
 * 達成条件を評価し、新規解除分を保存して返す（定義順）。
 * @param exclude 今回は付与しない key（demo seed が「立て直し」を先に消費しないために使う）
 */
export async function evaluateAchievements(userId: string, exclude: string[] = []): Promise<string[]> {
  const rows = await prisma.learningEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      domain: true,
      taskId: true,
      difficulty: true,
      axisRead: true,
      axisWrite: true,
      axisCode: true,
      success: true,
      hintCount: true,
      skillTags: true,
      generated: true,
      createdAt: true,
    },
  });
  const events: AchievementEvent[] = rows.map((r) => ({
    domain: r.domain,
    taskId: r.taskId,
    difficulty: r.difficulty,
    axes: { read: r.axisRead, write: r.axisWrite, code: r.axisCode },
    success: r.success,
    hintCount: r.hintCount,
    skillTags: r.skillTags,
    generated: r.generated,
    createdAt: r.createdAt,
  }));
  const unlocked = unlockedAchievements(events);

  const existing = await prisma.achievement.findMany({ where: { userId }, select: { key: true } });
  const have = new Set(existing.map((a) => a.key));
  const fresh = unlocked.filter((k) => !have.has(k) && !exclude.includes(k));
  if (fresh.length) {
    await prisma.achievement.createMany({
      data: fresh.map((key) => ({ userId, key })),
      skipDuplicates: true,
    });
  }
  return fresh;
}
