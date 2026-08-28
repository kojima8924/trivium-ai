// 4 人格との会話まわりのハンドラ（自由文の相談と「〜と話す」の宛先指定）。
// LLM は数秒かかるので、先に「考えています…」を返してから after() で生成して push する。
import "server-only";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/http";
import { resolveTask } from "@/lib/learn/service";
import { AGENTS, loadPersonas, type AgentKey } from "@/lib/persona";
import { TODAY_ACTION } from "../actions";
import { agentQuickReplies, askPrompt, chatReply, chatWithAgent } from "../chat";
import { pushTo, replyTo } from "../push";
import { taskContextFor } from "../quiz";
import { saveLineState, withAskNote } from "../state";
import { CHAT_LIMIT, requireLinked, warn, type AfterScheduler, type LineUser } from "./shared";

/** 4 人格との会話。先に受け付けを返し、after() で生成して push する。 */
export async function handleChat(
  lineUserId: string,
  replyToken: string,
  text: string,
  userId: string,
  agent: AgentKey,
  scheduleAfter: AfterScheduler,
  opts: { offerQuiz: boolean; pendingTaskId?: string },
): Promise<void> {
  const personas = await loadPersonas(userId);
  if (rateLimit(`line-chat:${userId}`, CHAT_LIMIT.count, CHAT_LIMIT.windowMs)) {
    await replyTo(replyToken, {
      text: `${personas[agent].name}: 少し話しすぎかも。10 分ほど休憩してからまた呼んで。問題を解くのは今すぐでも大丈夫。`,
      quickReplies: [TODAY_ACTION],
    }).catch(warn("reply failed"));
    return;
  }
  // LLM（＋Web 検索）は数秒かかるので、先に受け付けを返し、after() で生成して push する
  await replyTo(replyToken, { text: `${personas[agent].name}: 考えています…` }).catch(warn("reply failed"));
  scheduleAfter(async () => {
    try {
      // 出題中の課題について聞かれたら、その課題を文脈として渡す（答えは言わない指示つき）
      const pendingTask = opts.pendingTaskId ? await resolveTask(userId, opts.pendingTaskId) : null;
      const result = await chatWithAgent(userId, agent, text, pendingTask ? { currentTask: taskContextFor(pendingTask) } : {});
      const reply = await chatReply(userId, env.appUrl, result, { offerQuiz: opts.offerQuiz });
      await pushTo(lineUserId, reply).catch(warn("push failed"));
    } catch (err) {
      warn("chat failed")(err);
      await pushTo(lineUserId, {
        text: "いまは答えられませんでした。「今日の学習」で 1 問どうぞ。",
        quickReplies: await agentQuickReplies(userId, env.appUrl).catch(() => []),
      }).catch(() => undefined);
    }
  });
}

/** 「〜と話す」: 次の自由文（30 分以内）を指定人格宛てにする。 */
export async function handleAsk(lineUserId: string, replyToken: string, lu: LineUser, params: URLSearchParams): Promise<void> {
  const userId = await requireLinked(lu, replyToken);
  if (!userId) return;
  const raw = params.get("agent") ?? "LEADER";
  const agent: AgentKey = (AGENTS as readonly string[]).includes(raw) ? (raw as AgentKey) : "LEADER";
  const personas = await loadPersonas(userId);
  await saveLineState(lineUserId, withAskNote(lu.state, agent));
  await replyTo(replyToken, askPrompt(agent, personas[agent].name));
}
