// デモ用seed: 架空の 10 日分の learning_events を投入し、profile・スナップショット・実績を作る。
// 数値は scoring.ts / xp.ts の決定論的集計から出る（seed 直後の値は毎回同じ＝決定論）
import "server-only";
import { prisma } from "./prisma";
import { recomputeAll } from "./profile";
import { evaluateAchievements } from "./achievements";
import { unlockedAchievements, type AchievementEvent } from "./achievements.pure";
import { getTask } from "./tasks";
import { axesOf, computeDomainScore } from "./scoring";
import { DOMAINS } from "./domain";

type SeedSpec = { taskId: string; daysAgo: number; success: boolean; hintCount: number };

// サービスの説明（「1 日 3 問で今日のミッション達成」「AI はヒントを一段ずつ」）と噛み合う 10 日分の物語。
//   10日前 はじめた日（READ / WRITE の 2 問だけ）
//    9日前 ★ミッション達成（3 系統）
//    8日前 read-007 に失敗（ヒント 3 回でも届かず）
//    7日前 ★複合問題 mix-001（READ+WRITE）＋ LOGIC の 2 問でミッション達成
//    6日前 お休み
//    5日前 ★ミッション達成
//    4日前 code-014（難易度 9）に失敗。伸び悩む日
//    3日前 ★ミッション達成。read-007 に再挑戦して正解（リベンジ）
//    2日前 ★ミッション達成
//    1日前 ★ミッション達成。難易度 8 の LOGIC を突破、READ は難易度 7 に届かず
// 着地: READ Lv6 / WRITE Lv4 / LOGIC Lv7、streak 3、ミッション 6 日
//   → デモ中に code-006（難易度 8）をヒント 1 回で正答すると LOGIC Lv7 → Lv8、実績「立て直し」も解除される
const SPECS: SeedSpec[] = [
  // 10 日前: はじめた日（やさしい 2 問）
  { taskId: "read-004", daysAgo: 10, success: true, hintCount: 0 },
  { taskId: "write-004", daysAgo: 10, success: true, hintCount: 0 },
  // 9 日前: ★ミッション達成
  { taskId: "read-001", daysAgo: 9, success: true, hintCount: 0 },
  { taskId: "write-012", daysAgo: 9, success: true, hintCount: 1 },
  { taskId: "code-018", daysAgo: 9, success: true, hintCount: 0 },
  // 8 日前: 難易度 5 の読解に失敗（ヒント 3 回でも届かず）
  { taskId: "read-007", daysAgo: 8, success: false, hintCount: 3 },
  // 7 日前: ★複合問題（READ+WRITE）＋ LOGIC の 2 問でミッション達成
  { taskId: "mix-001", daysAgo: 7, success: true, hintCount: 1 },
  { taskId: "code-019", daysAgo: 7, success: true, hintCount: 0 },
  // 6 日前: お休み
  // 5 日前: ★ミッション達成
  { taskId: "read-006", daysAgo: 5, success: true, hintCount: 0 },
  { taskId: "write-005", daysAgo: 5, success: true, hintCount: 2 },
  { taskId: "code-004", daysAgo: 5, success: true, hintCount: 0 },
  // 4 日前: 難易度 9 に挑んで失敗（連続記録が途切れる日）
  { taskId: "code-014", daysAgo: 4, success: false, hintCount: 3 },
  // 3 日前: ★ミッション達成。read-007 にリベンジ成功
  { taskId: "read-007", daysAgo: 3, success: true, hintCount: 1 },
  { taskId: "write-s4-01", daysAgo: 3, success: true, hintCount: 0 },
  { taskId: "code-015", daysAgo: 3, success: true, hintCount: 0 },
  // 2 日前: ★ミッション達成（推敲は届かず）
  { taskId: "read-008", daysAgo: 2, success: true, hintCount: 0 },
  { taskId: "write-010", daysAgo: 2, success: false, hintCount: 3 },
  { taskId: "code-s7-01", daysAgo: 2, success: true, hintCount: 0 },
  // 1 日前: ★ミッション達成。LOGIC は難易度 8 を突破、READ は難易度 7 に届かず
  { taskId: "read-s6-01", daysAgo: 1, success: true, hintCount: 0 },
  { taskId: "write-s4-02", daysAgo: 1, success: true, hintCount: 1 },
  { taskId: "code-s8-01", daysAgo: 1, success: true, hintCount: 0 },
  { taskId: "read-s7-01", daysAgo: 1, success: false, hintCount: 3 },
];

/** seed が作る日数（スナップショットもこの日数分作る） */
const SEED_DAYS = 10;

export async function seedDemoForUser(userId: string, opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    await prisma.learningEvent.deleteMany({ where: { userId } });
    await prisma.achievement.deleteMany({ where: { userId } });
  }
  // 進行中の挑戦（ヒント回数）は常に消す。リハーサルを途中で止めたままだと、本番の1問目が「ヒント2回目」から始まってしまう
  await prisma.taskAttempt.deleteMany({ where: { userId } });
  // スナップショットは seed から作り直す（時系列グラフが二重にならないように）
  await prisma.profileSnapshot.deleteMany({ where: { userId } });
  // 日付境界（JST）に依存しないよう、各記録は「JST の正午」に固定する（ミッション日・streak・XP が実行時刻で変わらない）
  const jstNoonToday = (() => {
    const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
    const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
    return Date.UTC(y, m - 1, d, 3, 0, 0); // 12:00 JST = 03:00 UTC
  })();
  const dayAt = (daysAgo: number) => new Date(jstNoonToday - daysAgo * 86_400_000);
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

  // 時系列グラフ用のスナップショット: 10 日分、その日の終わりまでの記録で算出する
  const scorable = data.map((e) => ({
    domain: e.domain,
    difficulty: e.difficulty,
    axes: { read: e.axisRead, write: e.axisWrite, code: e.axisCode },
    success: e.success,
    hintCount: e.hintCount,
    skillTags: e.skillTags,
    createdAt: e.createdAt,
  }));
  const snapshots = [];
  for (let daysAgo = SEED_DAYS; daysAgo >= 1; daysAgo--) {
    const at = new Date(dayAt(daysAgo - 1).getTime() - 3_600_000); // 翌日の 11 時 = その日の記録だけを含む時点
    const upTo = scorable.filter((e) => e.createdAt <= at);
    if (upTo.length === 0) continue;
    const [read, write, code] = DOMAINS.map((d) => computeDomainScore(d, upTo, at).score);
    snapshots.push({ userId, read, write, code, createdAt: dayAt(daysAgo) });
  }
  if (snapshots.length) await prisma.profileSnapshot.createMany({ data: snapshots });

  await recomputeAll(userId);
  // 「立て直し」はデモ中にライブで解除されるよう seed では付与しない
  await evaluateAchievements(userId, ["comeback"]);
  await backdateAchievements(userId, scorable.map((e, i) => ({ ...e, taskId: data[i].taskId, generated: false })));
  return { inserted: data.length, snapshots: snapshots.length };
}

/**
 * 実績の解除日時を「実際に条件を満たしたイベントの時刻」に直す。
 * evaluateAchievements は now で入れるので、そのままだと時系列グラフ上で全部が一直線になる。
 */
async function backdateAchievements(userId: string, events: AchievementEvent[]): Promise<void> {
  const firstAt = new Map<string, Date>();
  const seen = new Set<string>();
  for (let i = 1; i <= events.length; i++) {
    const prefix = events.slice(0, i);
    const at = prefix[i - 1].createdAt;
    for (const key of unlockedAchievements(prefix, at)) {
      if (seen.has(key)) continue;
      seen.add(key);
      firstAt.set(key, at);
    }
  }
  const rows = await prisma.achievement.findMany({ where: { userId }, select: { id: true, key: true } });
  await Promise.all(
    rows
      .filter((r) => firstAt.has(r.key))
      .map((r) => prisma.achievement.update({ where: { id: r.id }, data: { unlockedAt: firstAt.get(r.key)! } })),
  );
}
