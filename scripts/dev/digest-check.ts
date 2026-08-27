// 日次総評 push の条件判定を確認する（テストユーザー。LINE の push は架空IDなので失敗するが、DailyDigest 行の作成を確認）
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { notifyDailyDigestIfComplete, jstDay } from "../../src/lib/learn/digest";
async function main() {
  const EMAIL = "digest+check@trivium.local", LINE_ID = "Utest-digest-check";
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.lineUser.deleteMany({ where: { lineUserId: LINE_ID } });
  const u = await prisma.user.create({ data: { email: EMAIL, name: "Digest Check" } });
  await prisma.lineUser.create({ data: { lineUserId: LINE_ID, userId: u.id, state: {} } });
  const ev = (domain: "READ" | "WRITE" | "CODE", taskId: string) => ({ userId: u.id, domain, taskId, difficulty: 3, answer: "x", success: true, hintCount: 1, skillTags: [] as string[] });
  await prisma.learningEvent.createMany({ data: [ev("READ", "read-001"), ev("WRITE", "write-001")] });
  console.log("2 domain のみ → 送らない:", await notifyDailyDigestIfComplete(u.id));
  await prisma.learningEvent.create({ data: ev("CODE", "code-003") });
  await prisma.profileSnapshot.createMany({ data: [{ userId: u.id, read: 50, write: 50, code: 50 }, { userId: u.id, read: 55, write: 50, code: 60 }] });
  console.log("3 domain 揃った → 送る(push は架空IDで失敗するが記録は残る):", await notifyDailyDigestIfComplete(u.id));
  const d = await prisma.dailyDigest.findUnique({ where: { userId_day: { userId: u.id, day: jstDay().day } } });
  console.log("DailyDigest:", d ? `day=${d.day} summary=${d.summary.slice(0, 120).replace(/\n/g, " / ")}` : "なし");
  console.log("同日2回目 → 送らない:", await notifyDailyDigestIfComplete(u.id));
  await prisma.user.delete({ where: { id: u.id } });
  await prisma.lineUser.deleteMany({ where: { lineUserId: LINE_ID } });
  console.log("後始末完了");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
