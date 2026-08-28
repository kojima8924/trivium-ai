// Dify 統合 Chatflow（trivium-chat）の疎通確認（開発用）。
//   npx tsx --conditions=react-server scripts/dev/dify-chat-check.ts "今日は何をやればいい？" [AUTO|READ|WRITE|CODE|LEADER] [learnerRef]
// DIFY_CHAT_API_KEY が必要。learnerRef を省略すると "dify-chat-check"（存在しない学習者）で試す
// ＝ Chatflow 側は /api/agent/context から found:false を受け取り、文脈なしで会話できるかを確認できる。
import "dotenv/config";
import { difyChat } from "../../src/lib/ai/dify";
import { env } from "../../src/lib/env";

async function main() {
  const [text = "今日は何をやればいい？", agentArg = "AUTO", ref = "dify-chat-check"] = process.argv.slice(2);
  const addressedAgent = agentArg.toUpperCase() as "AUTO" | "READ" | "WRITE" | "CODE" | "LEADER";
  console.log("chat via dify:", {
    keyConfigured: Boolean(env.ai.difyChatApiKey),
    lineChatViaDify: env.ai.lineChatViaDify,
    base: env.ai.difyApiBase,
    appUrl: env.appUrl,
  });
  if (!env.ai.difyChatApiKey) {
    console.error("DIFY_CHAT_API_KEY が未設定です");
    process.exit(1);
  }

  const t0 = Date.now();
  const first = await difyChat({ learnerRef: ref, addressedAgent, text, appUrl: env.appUrl });
  console.log(`\n=== 1 往復目 (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);
  console.log(first ? first.text : "(null: フォールバックされる)");

  if (!first) process.exit(1);

  // 会話 id を渡して継続できるか（担当をまたいでも文脈が続くこと）
  const t1 = Date.now();
  const second = await difyChat({
    learnerRef: ref,
    addressedAgent: "CODE",
    text: "さっき言っていたことを、もう少し短く言い直して。",
    appUrl: env.appUrl,
    conversationId: first.conversationId,
  });
  console.log(`\n=== 2 往復目・担当 CODE・会話継続 (${((Date.now() - t1) / 1000).toFixed(1)}s) ===`);
  console.log(second ? second.text : "(null)");
  console.log("\nconversation_id:", first.conversationId, "->", second?.conversationId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
