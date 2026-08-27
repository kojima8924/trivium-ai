// LINE webhook の振り分け確認（開発用・dev サーバに署名付きで送る）。
//   npx tsx --conditions=react-server scripts/dev/line-dispatch-check.ts
// 架空の LINE ユーザーを Web の使い捨てユーザーに連携させ、次を確認する（実 LINE への送信は 401 になるだけで記録は残る）:
//   1. 「論理パズルを出して」 → 会話ではなく作問（ChatTurn が増えず、GeneratedTask が増える）
//   2. 「READで1問」          → 出題（pendingTask.domain === READ）
//   3. 「今日の学習」          → 出題（pendingTask が設定される）
//   4. 「ケイ、これ教えて」    → 会話（ChatTurn に CODE 宛ての発話が入る）
//   5. 古い出題への回答 postback → 拒否（LearningEvent が増えない）
// 最後にテスト行を削除する。デモ用アカウントには触らない。
import "dotenv/config";
import { createHmac } from "node:crypto";
import { prisma } from "../../src/lib/prisma";

const BASE = process.env.LINE_CHECK_BASE ?? "http://localhost:3000";
const SECRET = process.env.LINE_CHANNEL_SECRET ?? "";
const LINE_ID = "Utest-dispatch-check";
const EMAIL = "line-dispatch-check@trivium.local";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("base64");
}

async function send(event: Record<string, unknown>): Promise<number> {
  const body = JSON.stringify({ destination: "x", events: [event] });
  const res = await fetch(`${BASE}/api/line/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-line-signature": sign(body) },
    body,
  });
  return res.status;
}

const base = () => ({ mode: "active", timestamp: Date.now(), webhookEventId: String(Date.now()), deliveryContext: { isRedelivery: false }, replyToken: "dummy", source: { type: "user", userId: LINE_ID } });
const text = (t: string) => ({ ...base(), type: "message", message: { id: "1", type: "text", text: t } });
const postback = (data: string) => ({ ...base(), type: "postback", postback: { data } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function state() {
  const lu = await prisma.lineUser.findUnique({ where: { lineUserId: LINE_ID } });
  return (lu?.state ?? {}) as { pendingTask?: { taskId: string; domain: string } };
}

async function main() {
  if (!SECRET) throw new Error("LINE_CHANNEL_SECRET が未設定");
  // 使い捨てユーザーと連携
  const user = await prisma.user.upsert({ where: { email: EMAIL }, update: {}, create: { email: EMAIL, name: "dispatch check" } });
  await prisma.lineUser.upsert({ where: { lineUserId: LINE_ID }, update: { userId: user.id, state: {} }, create: { lineUserId: LINE_ID, userId: user.id, state: {} } });
  const count = async () => ({
    chat: await prisma.chatTurn.count({ where: { userId: user.id } }),
    gen: await prisma.generatedTask.count({ where: { userId: user.id } }),
    events: await prisma.learningEvent.count({ where: { userId: user.id } }),
  });

  const ok: string[] = [];
  const ng: string[] = [];
  const check = (name: string, cond: boolean, detail: string) => (cond ? ok : ng).push(`${name}: ${detail}`);

  // 1. 作問
  let before = await count();
  console.log("1. 「論理パズルを出して」 →", await send(text("論理パズルを出して")));
  await sleep(20_000); // after() の作問（gpt-5.5）を待つ
  let after = await count();
  check("作問に到達", after.chat === before.chat && after.gen === before.gen + 1, `chat ${before.chat}→${after.chat}, gen ${before.gen}→${after.gen}`);

  // 2. READで1問
  console.log("2. 「READで1問」 →", await send(text("READで1問")));
  await sleep(1500);
  let st = await state();
  check("READ 出題", st.pendingTask?.domain === "READ", `pendingTask=${JSON.stringify(st.pendingTask)}`);

  // 3. 今日の学習（テキスト）
  console.log("3. 「今日の学習」 →", await send(text("今日の学習")));
  await sleep(1500);
  st = await state();
  check("今日の学習で出題", Boolean(st.pendingTask?.taskId), `pendingTask=${JSON.stringify(st.pendingTask)}`);
  const currentTask = st.pendingTask?.taskId ?? "";

  // 4. 呼びかけ → 会話
  before = await count();
  console.log("4. 「ケイ、これ教えて」 →", await send(text("ケイ、これ教えて")));
  await sleep(12_000);
  after = await count();
  const lastTurn = await prisma.chatTurn.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  check("会話に到達（CODE 宛て）", after.chat >= before.chat + 1 && lastTurn?.agent === "CODE", `chat ${before.chat}→${after.chat}, agent=${lastTurn?.agent}`);

  // 5. 古い出題への回答は拒否（現在の pendingTask と違う task）
  before = await count();
  console.log("5. 古い task への回答 →", await send(postback(`action=answer&task=code-001&choice=0`)));
  await sleep(1500);
  after = await count();
  check("古い回答を拒否", after.events === before.events, `events ${before.events}→${after.events}（pending=${currentTask}）`);

  // 6. 領域語だけは領域案内（会話に横取りされない）
  before = await count();
  console.log("6. 「LOGIC」 →", await send(text("LOGIC")));
  await sleep(1500);
  after = await count();
  check("領域語は会話にならない", after.chat === before.chat, `chat ${before.chat}→${after.chat}`);

  console.log("\nOK:", ok.length, "/ NG:", ng.length);
  for (const l of ok) console.log("  ✓", l);
  for (const l of ng) console.log("  ✗", l);

  // 後始末（cascade で LineUser / ChatTurn / GeneratedTask / TaskAttempt も消える）
  await prisma.lineUser.deleteMany({ where: { lineUserId: LINE_ID } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log("後始末: テスト行を削除しました");
  if (ng.length) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
