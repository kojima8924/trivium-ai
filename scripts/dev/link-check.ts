// LINE 連携トークンのラウンドトリップ検証（開発DBに対して実行）
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { issueLinkToken, consumeLinkToken, unlinkLineUser, isLinkedToLine } from "../../src/lib/line/link";

const LINE_ID = "Utest-link-check";

async function main() {
  const user = await prisma.user.findFirst({ where: { email: "demo+demo-learner@trivium.local" } });
  if (!user) throw new Error("demo user not found");

  await prisma.lineUser.deleteMany({ where: { lineUserId: LINE_ID } });
  await prisma.lineLinkToken.deleteMany({ where: { lineUserId: LINE_ID } });

  const t1 = await issueLinkToken(LINE_ID);
  console.log("1. 発行:", t1.token.slice(0, 8) + "…", `${t1.expiresInMinutes}分`);

  console.log("2. 不正トークン:", (await consumeLinkToken("bogus", user.id)).status);

  const r1 = await consumeLinkToken(t1.token, user.id);
  console.log("3. 消費:", r1.status, "/ linked =", await isLinkedToLine(user.id));

  console.log("4. 再消費(単回性):", (await consumeLinkToken(t1.token, user.id)).status);

  const t2 = await issueLinkToken(LINE_ID);
  console.log("5. 同一アカウントで再連携:", (await consumeLinkToken(t2.token, user.id)).status);

  const t3 = await issueLinkToken(LINE_ID);
  await prisma.lineLinkToken.update({ where: { token: t3.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
  console.log("6. 期限切れ:", (await consumeLinkToken(t3.token, user.id)).status);

  const t4 = await issueLinkToken(LINE_ID);
  const t5 = await issueLinkToken(LINE_ID);
  console.log("7. 新規発行で古い未使用は無効化:", (await consumeLinkToken(t4.token, user.id)).status, "/ 最新:", (await consumeLinkToken(t5.token, user.id)).status);

  console.log("8. 解除:", await unlinkLineUser(LINE_ID), "/ linked =", await isLinkedToLine(user.id));

  await prisma.lineUser.deleteMany({ where: { lineUserId: LINE_ID } });
  await prisma.lineLinkToken.deleteMany({ where: { lineUserId: LINE_ID } });
  console.log("後始末: テスト行を削除しました");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
