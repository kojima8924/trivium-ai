// デモ用seed: 架空の約10日分の learning_events を投入し、profile を再計算する。
// 目標像: READ ≈ 78 / WRITE ≈ 61 / CODE ≈ 86（決定論的集計なので厳密には一致しない）
import "server-only";
import { prisma } from "./prisma";
import { recomputeAll } from "./profile";
import { evaluateAchievements } from "./achievements";
import { tasksFor } from "./tasks";
import type { DomainKey } from "./domain";

type SeedSpec = { domain: DomainKey; daysAgo: number; success: boolean; hintCount: number; tags?: string[]; difficulty?: number };

// 「一回の失敗で断定しない」ことを示すため、失敗も適度に混ぜる
const SPECS: SeedSpec[] = [
  // CODE: 強い（トレース/アルゴリズム）。設計の言語化はやや弱い
  { domain: "CODE", daysAgo: 10, success: true, hintCount: 0, tags: ["tracing"], difficulty: 2 },
  { domain: "CODE", daysAgo: 9, success: true, hintCount: 0, tags: ["tracing"], difficulty: 3 },
  { domain: "CODE", daysAgo: 8, success: true, hintCount: 1, tags: ["debugging", "tracing"], difficulty: 3 },
  { domain: "CODE", daysAgo: 6, success: true, hintCount: 0, tags: ["algorithms", "tracing"], difficulty: 4 },
  { domain: "CODE", daysAgo: 5, success: true, hintCount: 0, tags: ["debugging"], difficulty: 3 },
  { domain: "CODE", daysAgo: 3, success: true, hintCount: 1, tags: ["design"], difficulty: 3 },
  { domain: "CODE", daysAgo: 2, success: true, hintCount: 0, tags: ["algorithms", "debugging"], difficulty: 4 },
  { domain: "CODE", daysAgo: 1, success: false, hintCount: 3, tags: ["design"], difficulty: 3 },
  // READ: 安定。批判的読解は改善余地
  { domain: "READ", daysAgo: 10, success: true, hintCount: 0, tags: ["comprehension"], difficulty: 2 },
  { domain: "READ", daysAgo: 8, success: true, hintCount: 0, tags: ["inference"], difficulty: 3 },
  { domain: "READ", daysAgo: 7, success: true, hintCount: 1, tags: ["comprehension"], difficulty: 3 },
  { domain: "READ", daysAgo: 5, success: false, hintCount: 3, tags: ["critical_reading", "inference"], difficulty: 4 },
  { domain: "READ", daysAgo: 4, success: true, hintCount: 0, tags: ["inference"], difficulty: 3 },
  { domain: "READ", daysAgo: 2, success: true, hintCount: 2, tags: ["critical_reading", "inference"], difficulty: 4 },
  // WRITE: 構成はできるが、反論検討・推敲が少ない
  { domain: "WRITE", daysAgo: 9, success: true, hintCount: 1, tags: ["structure", "reasoning"], difficulty: 2 },
  { domain: "WRITE", daysAgo: 6, success: true, hintCount: 2, tags: ["reasoning", "structure"], difficulty: 3 },
  { domain: "WRITE", daysAgo: 4, success: false, hintCount: 3, tags: ["revision", "clarity"], difficulty: 3 },
  { domain: "WRITE", daysAgo: 1, success: true, hintCount: 2, tags: ["structure", "reasoning"], difficulty: 3 },
];

export async function seedDemoForUser(userId: string, opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    await prisma.learningEvent.deleteMany({ where: { userId } });
    await prisma.achievement.deleteMany({ where: { userId } });
  }
  const now = Date.now();
  const data = SPECS.map((s, i) => {
    const pool = tasksFor(s.domain);
    // タグが合うタスクを優先。無ければ難易度の近いもの
    const task =
      pool.find((t) => s.tags?.every((tag) => t.skillTags.includes(tag))) ??
      [...pool].sort((a, b) => Math.abs(a.difficulty - (s.difficulty ?? 3)) - Math.abs(b.difficulty - (s.difficulty ?? 3)))[0];
    const createdAt = new Date(now - s.daysAgo * 86_400_000 - (i % 5) * 3_600_000 - 15 * 60_000);
    return {
      userId,
      domain: s.domain,
      taskId: task.id,
      difficulty: s.difficulty ?? task.difficulty,
      answer: "(demo seed)",
      success: s.success,
      hintCount: s.hintCount,
      latencyMs: 40_000 + ((i * 7919) % 90_000),
      skillTags: s.tags ?? task.skillTags,
      createdAt,
    };
  });
  await prisma.learningEvent.createMany({ data });
  await recomputeAll(userId);
  await evaluateAchievements(userId);
  return { inserted: data.length };
}
