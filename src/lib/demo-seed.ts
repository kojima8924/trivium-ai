// デモ用seed: 架空の約10日分の learning_events を投入し、profile を再計算する。
// 実測（seed 直後）: READ 72 / WRITE 57 / CODE 79。数値は scoring.ts の決定論的集計から出る
import "server-only";
import { prisma } from "./prisma";
import { recomputeAll } from "./profile";
import { evaluateAchievements } from "./achievements";
import { tasksFor } from "./tasks";
import type { DomainKey } from "./domain";

type SeedSpec = { domain: DomainKey; daysAgo: number; success: boolean; hintCount: number; tags?: string[]; difficulty?: number };

// 「一回の失敗で断定しない」ことを示すため、失敗も適度に混ぜる
const SPECS: SeedSpec[] = [
  // CODE: 強い（トレース/アルゴリズム/デバッグ）。設計の言語化はやや弱い
  { domain: "CODE", daysAgo: 10, success: true, hintCount: 0, tags: ["tracing"], difficulty: 4 },
  { domain: "CODE", daysAgo: 9, success: true, hintCount: 0, tags: ["tracing"], difficulty: 6 },
  { domain: "CODE", daysAgo: 8, success: true, hintCount: 1, tags: ["debugging", "tracing"], difficulty: 6 },
  { domain: "CODE", daysAgo: 7, success: true, hintCount: 0, tags: ["tracing", "algorithms"], difficulty: 8 },
  { domain: "CODE", daysAgo: 6, success: true, hintCount: 0, tags: ["algorithms", "debugging"], difficulty: 8 },
  { domain: "CODE", daysAgo: 5, success: true, hintCount: 0, tags: ["debugging"], difficulty: 6 },
  { domain: "CODE", daysAgo: 4, success: true, hintCount: 0, tags: ["tracing"], difficulty: 8 },
  { domain: "CODE", daysAgo: 3, success: true, hintCount: 1, tags: ["design"], difficulty: 6 },
  { domain: "CODE", daysAgo: 2, success: true, hintCount: 0, tags: ["algorithms", "debugging"], difficulty: 8 },
  { domain: "CODE", daysAgo: 1, success: false, hintCount: 3, tags: ["design"], difficulty: 6 },
  // READ: 要旨把握・推論は安定。批判的読解（複数視点の比較）は改善余地
  { domain: "READ", daysAgo: 10, success: true, hintCount: 0, tags: ["comprehension"], difficulty: 4 },
  { domain: "READ", daysAgo: 8, success: true, hintCount: 0, tags: ["inference"], difficulty: 6 },
  { domain: "READ", daysAgo: 7, success: true, hintCount: 0, tags: ["comprehension"], difficulty: 6 },
  { domain: "READ", daysAgo: 6, success: true, hintCount: 1, tags: ["inference"], difficulty: 8 },
  { domain: "READ", daysAgo: 5, success: false, hintCount: 3, tags: ["critical_reading", "inference"], difficulty: 8 },
  { domain: "READ", daysAgo: 4, success: true, hintCount: 0, tags: ["inference"], difficulty: 6 },
  { domain: "READ", daysAgo: 3, success: true, hintCount: 0, tags: ["comprehension"], difficulty: 6 },
  { domain: "READ", daysAgo: 2, success: true, hintCount: 2, tags: ["critical_reading", "inference"], difficulty: 8 },
  // WRITE: 構成はできるが、反論検討・推敲が少ない
  { domain: "WRITE", daysAgo: 9, success: true, hintCount: 1, tags: ["structure", "reasoning"], difficulty: 4 },
  { domain: "WRITE", daysAgo: 7, success: true, hintCount: 0, tags: ["structure", "reasoning"], difficulty: 4 },
  { domain: "WRITE", daysAgo: 6, success: true, hintCount: 2, tags: ["reasoning", "structure"], difficulty: 6 },
  { domain: "WRITE", daysAgo: 4, success: false, hintCount: 3, tags: ["revision", "clarity"], difficulty: 6 },
  { domain: "WRITE", daysAgo: 1, success: true, hintCount: 2, tags: ["structure", "reasoning"], difficulty: 6 },
];

export async function seedDemoForUser(userId: string, opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    await prisma.learningEvent.deleteMany({ where: { userId } });
    await prisma.achievement.deleteMany({ where: { userId } });
  }
  // 進行中の挑戦（ヒント回数）は常に消す。リハーサルを途中で止めたままだと、本番の1問目が「ヒント2回目」から始まってしまう
  await prisma.taskAttempt.deleteMany({ where: { userId } });
  const now = Date.now();
  const data = SPECS.map((s, i) => {
    const pool = tasksFor(s.domain);
    // タグが合うタスクを優先。無ければ難易度の近いもの
    const task =
      pool.find((t) => s.tags?.every((tag) => t.skillTags.includes(tag))) ??
      [...pool].sort((a, b) => Math.abs(a.difficulty - (s.difficulty ?? 3)) - Math.abs(b.difficulty - (s.difficulty ?? 3)))[0];
    const createdAt = new Date(now - s.daysAgo * 86_400_000 - (i % 5) * 3_600_000 - 15 * 60_000);
    const difficulty = s.difficulty ?? task.difficulty;
    return {
      userId,
      domain: s.domain,
      taskId: task.id,
      difficulty,
      axisRead: s.domain === "READ" ? difficulty : 0,
      axisWrite: s.domain === "WRITE" ? difficulty : 0,
      axisCode: s.domain === "CODE" ? difficulty : 0,
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
  // 「立て直し」はデモ中にライブで解除されるよう seed では付与しない
  await evaluateAchievements(userId, ["comeback"]);
  return { inserted: data.length };
}
