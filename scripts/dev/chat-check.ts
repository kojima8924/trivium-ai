// 4 人格との会話（chatWithAgent）と観察メモ更新の実 API 検証（開発用）。
//   npx tsx --conditions=react-server scripts/dev/chat-check.ts
// テストユーザーを作って直列に実行し、最後に削除する。デモ用アカウントには触れない。
// 確認すること: 時刻が反映される / 人格（ツンデレの LEADER・コーチの CODE）が出る / 検索が使われる。
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { aiStatus } from "../../src/lib/ai";
import { chatWithAgent, chatReply } from "../../src/lib/line/chat";
import { updateMemoryAfterEvent, updateLeaderMemory, getAllMemories } from "../../src/lib/memory";
import { env } from "../../src/lib/env";

const EMAIL = "chat-check@trivium.local";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`\n=== ${label} (${Date.now() - t0} ms / provider=${aiStatus().lastUsed}) ===`);
  console.log(JSON.stringify(r, null, 2));
  return r;
}

async function main() {
  console.log("provider:", aiStatus());
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({ data: { email: EMAIL, name: "Chat Check" } });
  const userId = user.id;
  try {
    // 1) 観察メモ: CODE で 1 問決着した体で更新 → LEADER のメモも更新
    await timed("updateMemoryAfterEvent(CODE)", () =>
      updateMemoryAfterEvent(userId, "CODE", {
        taskTitle: "バグ発見: 平均値の計算",
        domain: "CODE",
        axes: { read: 0, write: 0, code: 5 },
        success: true,
        hintCount: 1,
        answer: "3.0",
      }),
    );
    await timed("updateLeaderMemory", () => updateLeaderMemory(userId));
    await timed("memories", () => getAllMemories(userId));

    // 2) 会話: LEADER（ツンデレ）→ CODE（コーチ）→ 検索が要る質問（LEADER）
    const a = await timed("chat LEADER", () => chatWithAgent(userId, "LEADER", "ミチ、今日は何をやればいい？"));
    await timed("chatReply LEADER", () => chatReply(userId, env.appUrl, a));
    await timed("chat CODE", () => chatWithAgent(userId, "CODE", "ロゴス、順番を決める問題で毎回時間がかかる。コツある？"));
    await timed("chat LEADER (search)", () => chatWithAgent(userId, "LEADER", "今日の日付と、最近の Python の安定版はいくつ？"));
    // 3) 履歴が積まれているか
    const turns = await prisma.chatTurn.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { agent: true, role: true, text: true } });
    console.log("\n=== chat turns ===");
    for (const t of turns) console.log(`${t.agent}\t${t.role}\t${t.text.slice(0, 60)}`);
    console.log("lastError:", aiStatus().lastError);
  } finally {
    await prisma.user.deleteMany({ where: { email: EMAIL } }); // cascade で memory / chat も消える
    console.log("後始末: テストユーザーを削除しました");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
