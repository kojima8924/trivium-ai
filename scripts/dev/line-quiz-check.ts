// LINE 出題フローの結合検証（開発DB + dev サーバ）。テストユーザーを作り、署名付き webhook を叩き、最後に削除する。
//   npx tsx --conditions=react-server scripts/dev/line-quiz-check.ts
import "dotenv/config";
import { createHmac } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { resolveTask } from "../../src/lib/learn/service";

const B = process.env.CHECK_BASE ?? "http://localhost:3000";
const LINE_ID = "Utest-quiz-check-0001";
const EMAIL = "linequiz+check@trivium.local";
const SECRET = process.env.LINE_CHANNEL_SECRET ?? "";

async function post(events: unknown[]) {
  const body = JSON.stringify({ destination: "x", events });
  const sig = createHmac("sha256", SECRET).update(body).digest("base64");
  const res = await fetch(`${B}/api/line/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-line-signature": sig },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const msg = (text: string) => ({ type: "message", mode: "active", timestamp: 0, webhookEventId: "1", deliveryContext: { isRedelivery: false }, replyToken: "dummy", source: { type: "user", userId: LINE_ID }, message: { id: "1", type: "text", text } });
const pb = (data: string) => ({ type: "postback", mode: "active", timestamp: 0, webhookEventId: "1", deliveryContext: { isRedelivery: false }, replyToken: "dummy", source: { type: "user", userId: LINE_ID }, postback: { data } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function state() {
  const lu = await prisma.lineUser.findUnique({ where: { lineUserId: LINE_ID } });
  return (lu?.state ?? {}) as { pendingTask?: { taskId: string; domain: string } };
}

async function main() {
  if (!SECRET) throw new Error("LINE_CHANNEL_SECRET が未設定");
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.lineUser.deleteMany({ where: { lineUserId: LINE_ID } });
  const user = await prisma.user.create({ data: { email: EMAIL, name: "LINE Quiz Check" } });

  console.log("1. 未連携で「今日の学習」→ 出題されず連携案内（pendingTask なし）");
  console.log("   ", (await post([pb("action=today")])).status, JSON.stringify(await state()));

  await prisma.lineUser.upsert({ where: { lineUserId: LINE_ID }, update: { userId: user.id }, create: { lineUserId: LINE_ID, userId: user.id, state: {} } });

  console.log("2. 連携後に「今日の学習」→ pendingTask が入る");
  console.log("   ", (await post([pb("action=today")])).status, JSON.stringify(await state()));
  const s1 = await state();
  const task = s1.pendingTask ? await resolveTask(user.id, s1.pendingTask.taskId) : null;
  if (!task || task.kind !== "choice") throw new Error("choice の課題が出題されていない");
  const correct = Number(task.answerKey?.[0] ?? "0");
  const wrong = (correct + 1) % (task.choices?.length ?? 4);
  console.log("    task:", task.id, task.title, "kind", task.kind, "correct", correct);

  console.log("3. 誤答 → retry（attempt が 1 に）");
  console.log("   ", (await post([pb(`action=answer&task=${task.id}&choice=${wrong}`)])).status);
  const att = await prisma.taskAttempt.findUnique({ where: { userId_taskId: { userId: user.id, taskId: task.id } } });
  console.log("    attempt hintCount:", att?.hintCount, "| pending 継続:", Boolean((await state()).pendingTask));

  console.log("4. 正答 → 決着（event 記録・pending 解除・after() で finalize）");
  console.log("   ", (await post([pb(`action=answer&task=${task.id}&choice=${correct}`)])).status);
  await sleep(15000);
  const ev = await prisma.learningEvent.findMany({ where: { userId: user.id } });
  const prof = await prisma.domainProfile.findMany({ where: { userId: user.id } });
  console.log("    events:", ev.map((e) => `${e.domain} success=${e.success} hints=${e.hintCount}`), "| pending:", Boolean((await state()).pendingTask), "| profiles:", prof.map((p) => `${p.domain}=${p.score}`));

  console.log("5. 講評キャッシュ: 同じ課題・同じ誤答の講評が保存されている");
  const cache = await prisma.taskFeedbackCache.findMany({ where: { taskId: task.id } });
  console.log("    cache rows:", cache.length);

  console.log("6. READ で1問（text）→ domain 指定の出題");
  console.log("   ", (await post([msg("READで1問")])).status, JSON.stringify((await state()).pendingTask));

  console.log("7. 自由文の作問 → after() で GeneratedTask が作られ、pendingTask が差し替わる");
  console.log("   ", (await post([msg("論理パズルを1問出して")])).status);
  await sleep(15000);
  const gen = await prisma.generatedTask.findMany({ where: { userId: user.id } });
  console.log("    generated:", gen.map((g) => `${g.id} ${g.domain} ${g.kind} "${g.title}"`), "| pending:", JSON.stringify((await state()).pendingTask));

  console.log("8. ギブアップ（生成課題）→ failed で決着");
  const s2 = await state();
  if (s2.pendingTask) {
    console.log("   ", (await post([pb(`action=giveup&task=${s2.pendingTask.taskId}`)])).status);
    await sleep(12000);
    const ev2 = await prisma.learningEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    console.log("    events:", ev2.map((e) => `${e.domain}:${e.taskId} success=${e.success}`));
  }

  await prisma.user.delete({ where: { id: user.id } }); // cascade: events/profiles/generated/lineUser.userId は SetNull
  await prisma.lineUser.deleteMany({ where: { lineUserId: LINE_ID } });
  await prisma.taskFeedbackCache.deleteMany({ where: { taskId: task.id } });
  console.log("後始末: テストユーザー・LineUser・キャッシュ行を削除しました");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
