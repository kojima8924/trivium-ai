// 少数の achievement（学習行動に基づく。決定論）
import "server-only";
import { prisma } from "./prisma";
import { DOMAINS } from "./domain";

export const ACHIEVEMENTS: Record<string, { title: string; description: string }> = {
  first_step: { title: "最初の一歩", description: "初めて課題に取り組んだ" },
  no_hint: { title: "ノーヒント", description: "ヒントなしで正解した" },
  comeback: { title: "立て直し", description: "誤答のあとヒントで正解にたどり着いた" },
  trivium: { title: "TRIVIUM", description: "READ / WRITE / CODE すべてに取り組んだ" },
  ten_events: { title: "継続", description: "学習記録が10件に達した" },
  hard_clear: { title: "高難度クリア", description: "難易度4以上の課題を解いた" },
};

/**
 * 達成条件を評価し、新規解除分を保存して返す。
 * @param exclude 今回は付与しない key（demo seed が「立て直し」を先に消費しないために使う）
 */
export async function evaluateAchievements(userId: string, exclude: string[] = []): Promise<string[]> {
  const events = await prisma.learningEvent.findMany({
    where: { userId },
    select: { domain: true, success: true, hintCount: true, difficulty: true },
  });
  const unlocked = new Set<string>();
  if (events.length >= 1) unlocked.add("first_step");
  if (events.some((e) => e.success && e.hintCount === 0)) unlocked.add("no_hint");
  if (events.some((e) => e.success && e.hintCount >= 1)) unlocked.add("comeback");
  if (DOMAINS.every((d) => events.some((e) => e.domain === d))) unlocked.add("trivium");
  if (events.length >= 10) unlocked.add("ten_events");
  if (events.some((e) => e.success && e.difficulty >= 4)) unlocked.add("hard_clear");

  const existing = await prisma.achievement.findMany({ where: { userId }, select: { key: true } });
  const have = new Set(existing.map((a) => a.key));
  const fresh = [...unlocked].filter((k) => !have.has(k) && !exclude.includes(k));
  if (fresh.length) {
    await prisma.achievement.createMany({
      data: fresh.map((key) => ({ userId, key })),
      skipDuplicates: true,
    });
  }
  return fresh;
}
