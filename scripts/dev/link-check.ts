// LINE 連携トークンのラウンドトリップ検証（開発DBに対して実行）
//   npx tsx --conditions=react-server scripts/dev/link-check.ts
// デモ用アカウントの学習データには触れない（LineUser / LineLinkToken のテスト行だけを作って消す）。
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { issueLinkToken, consumeLinkToken, unlinkLineUser, isLinkedToLine, isLinkResultGenuine } from "../../src/lib/line/link";

const LINE_ID = "Utest-link-check";
const LINE_ID_2 = "Utest-link-check-2";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`検証失敗: ${msg}`);
}

async function cleanup() {
  await prisma.lineUser.deleteMany({ where: { lineUserId: { in: [LINE_ID, LINE_ID_2] } } });
  await prisma.lineLinkToken.deleteMany({ where: { lineUserId: { in: [LINE_ID, LINE_ID_2] } } });
}

async function main() {
  const user = await prisma.user.findFirst({ where: { email: "demo+demo-learner@trivium.local" } });
  if (!user) throw new Error("demo user not found");
  await cleanup();

  const t1 = await issueLinkToken(LINE_ID);
  console.log("1. 発行:", t1.token.slice(0, 8) + "…", `${t1.expiresInMinutes}分`);

  console.log("2. 不正トークン:", (await consumeLinkToken("bogus", user.id)).status);
  assert(!(await isLinkResultGenuine("bogus", user.id)), "不正トークンで結果が本物扱いされた");

  const r1 = await consumeLinkToken(t1.token, user.id);
  console.log("3. 消費:", r1.status, "/ linked =", await isLinkedToLine(user.id), "/ genuine =", await isLinkResultGenuine(t1.token, user.id));
  assert(r1.status === "linked", "初回消費が linked でない");

  console.log("4. 再消費(単回性):", (await consumeLinkToken(t1.token, user.id)).status);

  const t2 = await issueLinkToken(LINE_ID);
  console.log("5. 同一アカウントで再連携:", (await consumeLinkToken(t2.token, user.id)).status);

  const t3 = await issueLinkToken(LINE_ID);
  await prisma.lineLinkToken.update({ where: { token: t3.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
  console.log("6. 期限切れ:", (await consumeLinkToken(t3.token, user.id)).status);

  const t4 = await issueLinkToken(LINE_ID);
  const t5 = await issueLinkToken(LINE_ID);
  console.log("7. 新規発行で古い未使用は無効化:", (await consumeLinkToken(t4.token, user.id)).status, "/ 最新:", (await consumeLinkToken(t5.token, user.id)).status);

  // 8a. 同一 tick の 2-way レース × 10 回（毎回新しいトークン）→ 毎回 linked 1 / used 1
  //     読み取り→更新の間に割り込める旧実装ではここで両方 linked になる
  for (let i = 0; i < 10; i++) {
    const t = await issueLinkToken(LINE_ID_2);
    const [a, b] = await Promise.all([consumeLinkToken(t.token, user.id), consumeLinkToken(t.token, user.id)]);
    const pair = [a.status, b.status].sort().join("+");
    assert(pair === "linked+used" || pair === "already+used", `2-way レース ${i + 1}: ${pair}`);
  }
  console.log("8a. 2-way 同時消費 ×10: すべて 消費1件 / used 1件");

  // 8b. N 並列（既定 8、LINK_CHECK_PARALLEL で変更）。開始を 25ms ずつずらして重ねる。
  //     `npx prisma dev` のローカルPGは多重接続でプロトコルエラー（P1017 / P2039）を返すことがあるので、
  //     その2種だけは「ローカルDBの制限」として警告に留める（単回性の証明は 8a で済んでいる。本番PGでは通る想定）
  const parallel = Number(process.env.LINK_CHECK_PARALLEL ?? 8);
  const t6 = await issueLinkToken(LINE_ID_2);
  try {
    const results = await Promise.all(
      Array.from({ length: parallel }, (_, i) =>
        new Promise<Awaited<ReturnType<typeof consumeLinkToken>>>((resolve, reject) =>
          setTimeout(() => consumeLinkToken(t6.token, user.id).then(resolve, reject), i * 25),
        ),
      ),
    );
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    console.log(`8b. 同時消費 ${parallel} 並列（25ms ずらし）:`, JSON.stringify(counts));
    assert((counts.linked ?? 0) + (counts.already ?? 0) === 1, `消費成功が 1 件でない: ${JSON.stringify(counts)}`);
    assert((counts.used ?? 0) === parallel - 1, `used が ${parallel - 1} 件でない: ${JSON.stringify(counts)}`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P1017" || code === "P2039") {
      console.log(`8b. 同時消費 ${parallel} 並列: ローカル prisma dev の多重接続制限（${code}）でスキップ。LINK_CHECK_PARALLEL を下げて再実行可`);
    } else {
      throw e;
    }
  }

  // 9. 掃除: 使用済み・期限切れは次の発行で消える
  const before = await prisma.lineLinkToken.count({ where: { lineUserId: { in: [LINE_ID, LINE_ID_2] } } });
  await issueLinkToken(LINE_ID);
  const after = await prisma.lineLinkToken.findMany({ where: { lineUserId: { in: [LINE_ID, LINE_ID_2] } } });
  console.log("9. 掃除:", before, "件 →", after.length, "件（残りは未使用・期限内のみ:", after.every((r) => !r.usedAt && r.expiresAt > new Date()), ")");
  assert(after.every((r) => !r.usedAt && r.expiresAt > new Date()), "使用済み/期限切れが残っている");

  console.log("10. 解除:", await unlinkLineUser(LINE_ID), "/ linked(LINE_ID_2 が残る) =", await isLinkedToLine(user.id));
  console.log("11. 解除2:", await unlinkLineUser(LINE_ID_2), "/ linked =", await isLinkedToLine(user.id));

  await cleanup();
  console.log("後始末: テスト行を削除しました");
}

main()
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => undefined);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
