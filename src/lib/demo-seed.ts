// デモ用seed: 架空の約10日分の learning_events を投入し、profile を再計算する。
// 数値は scoring.ts の決定論的集計から出る（seed 直後の実測値は DEMO.md 参照）
import "server-only";
import { prisma } from "./prisma";
import { recomputeAll } from "./profile";
import { evaluateAchievements } from "./achievements";
import { getTask } from "./tasks";
import { axesOf } from "./scoring";

type SeedSpec = { taskId: string; daysAgo: number; success: boolean; hintCount: number };

// 到達レベルの物語（採点モデル: src/lib/scoring.ts）
//   LOGIC: Lv7（難易度8の正答率が閾値未満）→ デモで code-006（難易度8）をヒント1回で正答すると Lv8 に上がる
//   READ : Lv6（批判的読解の高難度で失敗あり）
//   WRITE: Lv4（推敲・明確さが弱い）
// taskId で指定するので、履歴の課題名・難易度は実際の問題と一致する
const SPECS: SeedSpec[] = [
  // LOGIC
  { taskId: "code-001", daysAgo: 10, success: true, hintCount: 0 },
  { taskId: "code-002", daysAgo: 9, success: true, hintCount: 0 },
  { taskId: "code-012", daysAgo: 9, success: false, hintCount: 3 }, // 難易度9 計算量: 失敗（Lv8 の壁）
  { taskId: "code-003", daysAgo: 8, success: true, hintCount: 1 },
  { taskId: "code-019", daysAgo: 7, success: true, hintCount: 0 },
  { taskId: "code-017", daysAgo: 6, success: true, hintCount: 0 },
  { taskId: "code-015", daysAgo: 5, success: true, hintCount: 0 },
  { taskId: "code-010", daysAgo: 4, success: true, hintCount: 0 },
  { taskId: "code-025", daysAgo: 3, success: true, hintCount: 1 },
  { taskId: "code-s8-01", daysAgo: 3, success: true, hintCount: 0 },
  { taskId: "code-020", daysAgo: 2, success: true, hintCount: 0 },
  { taskId: "code-s10-01", daysAgo: 1, success: false, hintCount: 3 }, // 難易度10（ストック）: 失敗（Lv8 の壁）
  // READ
  { taskId: "read-012", daysAgo: 10, success: true, hintCount: 0 },
  { taskId: "read-004", daysAgo: 9, success: true, hintCount: 0 },
  { taskId: "read-001", daysAgo: 8, success: true, hintCount: 0 },
  { taskId: "read-002", daysAgo: 7, success: true, hintCount: 0 },
  { taskId: "read-006", daysAgo: 6, success: true, hintCount: 1 },
  { taskId: "read-010", daysAgo: 5, success: true, hintCount: 0 },
  { taskId: "read-007", daysAgo: 4, success: true, hintCount: 0 },
  { taskId: "read-008", daysAgo: 3, success: true, hintCount: 0 },
  { taskId: "read-s7-01", daysAgo: 3, success: true, hintCount: 0 },
  { taskId: "read-003", daysAgo: 2, success: false, hintCount: 3 }, // 批判的読解: 失敗
  { taskId: "read-011", daysAgo: 1, success: true, hintCount: 1 },
  // WRITE
  { taskId: "write-004", daysAgo: 9, success: true, hintCount: 0 },
  { taskId: "write-012", daysAgo: 8, success: true, hintCount: 0 },
  { taskId: "write-005", daysAgo: 7, success: true, hintCount: 1 },
  { taskId: "write-006", daysAgo: 6, success: true, hintCount: 0 },
  { taskId: "write-003", daysAgo: 5, success: true, hintCount: 2 },
  { taskId: "write-001", daysAgo: 4, success: true, hintCount: 1 },
  { taskId: "write-011", daysAgo: 8, success: false, hintCount: 3 }, // 推敲: 失敗
  { taskId: "write-010", daysAgo: 2, success: true, hintCount: 2 },
  { taskId: "write-s4-01", daysAgo: 1, success: true, hintCount: 0 },
];

export async function seedDemoForUser(userId: string, opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    await prisma.learningEvent.deleteMany({ where: { userId } });
    await prisma.achievement.deleteMany({ where: { userId } });
  }
  // 進行中の挑戦（ヒント回数）は常に消す。リハーサルを途中で止めたままだと、本番の1問目が「ヒント2回目」から始まってしまう
  await prisma.taskAttempt.deleteMany({ where: { userId } });
  // 日付境界（JST）に依存しないよう、各記録は「JST の正午」に固定する（ミッション日・streak・XP が実行時刻で変わらない）
  const jstNoonToday = (() => {
    const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
    const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
    return Date.UTC(y, m - 1, d, 3, 0, 0); // 12:00 JST = 03:00 UTC
  })();
  const data = SPECS.map((spec, i) => {
    const task = getTask(spec.taskId);
    if (!task) throw new Error(`demo seed: unknown task ${spec.taskId}`);
    const axes = axesOf(task);
    const createdAt = new Date(jstNoonToday - spec.daysAgo * 86_400_000 + (i % 5) * 7 * 60_000);
    return {
      userId,
      domain: task.domain,
      taskId: task.id,
      difficulty: task.difficulty,
      axisRead: axes.read,
      axisWrite: axes.write,
      axisCode: axes.code,
      answer: "(demo seed)",
      success: spec.success,
      hintCount: spec.hintCount,
      latencyMs: 40_000 + ((i * 7919) % 90_000),
      skillTags: task.skillTags,
      createdAt,
    };
  });
  await prisma.learningEvent.createMany({ data });
  await recomputeAll(userId);
  // 「立て直し」はデモ中にライブで解除されるよう seed では付与しない
  await evaluateAchievements(userId, ["comeback"]);
  return { inserted: data.length };
}
