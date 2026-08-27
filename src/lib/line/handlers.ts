// LINE webhook の意図別ハンドラ（server-only）。HTTP 契約と署名検証は route.ts が担当する。
//
// テキストの振り分け順（連携済みユーザー）:
//   (1) link / unlink / help          → ルールベース（常に最優先）
//   (2) 人格の名前での呼びかけ         → その人格との会話（「ケイ、〜」「アオイに聞きたい」。名前限定・部分一致なし）
//       または直前に「〜に聞く」を押していた → その人格との会話
//   (3) quiz / generate / domain / today / history / profile / short_time / tired 等の既知の意図 → 従来処理
//   (4) 残り（unknown）                → 案内役（LEADER）との会話
// 未連携ユーザーは (2)(4) を行わず、従来のルールベース応答（連携案内つき）に落ちる。
import "server-only";
import { LINE } from "@/config/trivium.config";
import type { webhook } from "@line/bot-sdk";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/http";
import { notifyDailyDigestIfComplete } from "@/lib/learn/digest";
import { parseDomain, type DomainKey } from "@/lib/domain";
import { AGENTS, loadPersonas, type AgentKey } from "@/lib/persona";
import { detectAddressedAgent } from "@/lib/persona.pure";
import { agentQuickReplies, askPrompt, chatReply, chatWithAgent } from "./chat";
import { buildPostbackReply, buildReply, classifyIntent, domainOf, welcomeReply, type Intent, type LeaderContext, type LeaderReply } from "./leader";
import { issueLinkToken, unlinkLineUser } from "./link";
import { pushTo, replyFlex, replyTo } from "./push";
import {
  answerQuiz,
  buildProfileCard,
  generateAndBuildPush,
  generatingReply,
  giveUpQuiz,
  needLinkReply,
  settleAndBuildPush,
  startQuiz,
} from "./quiz";
import { loadLineUser, noteSuggestion, saveLineState, withPendingTask, type LineState } from "./state";

type LineUser = Awaited<ReturnType<typeof loadLineUser>>;
type AfterScheduler = (task: () => void | Promise<void>) => void;

/** LINE 経由の LLM 呼び出しの利用者単位の上限（Web API の制限を迂回させない） */
const CHAT_LIMIT = { count: 20, windowMs: 10 * 60_000 };
const GENERATE_LIMIT = { count: 6, windowMs: 10 * 60_000 };

/** 検証済みイベントを種類ごとのハンドラへ振り分ける。 */
export async function handleLineEvent(event: webhook.Event, scheduleAfter: AfterScheduler): Promise<void> {
  const lineUserId = event.source?.type === "user" ? event.source.userId : undefined;
  if (!lineUserId) return; // グループ/ルームは対象外

  if (event.type === "follow") {
    const lu = await loadLineUser(lineUserId);
    await replyTo(event.replyToken, welcomeReply(await contextFor(lu)));
    return;
  }
  if (event.type === "message") {
    if (event.message.type !== "text" || !event.replyToken) return;
    await handleMessage(lineUserId, event.replyToken, event.message.text, scheduleAfter);
    return;
  }
  if (event.type === "postback") {
    if (!event.replyToken) return;
    await handlePostback(lineUserId, event.replyToken, event.postback.data, scheduleAfter);
  }
  // それ以外（unfollow 等）は無視
}

async function handleMessage(lineUserId: string, replyToken: string, text: string, scheduleAfter: AfterScheduler): Promise<void> {
  const lu = await loadLineUser(lineUserId);
  const intent = classifyIntent(text);

  // (1) 連携・解除・ヘルプは常に最優先
  if (intent.kind === "link" || intent.kind === "unlink" || intent.kind === "help") {
    await handleRuleBasedMessage(lineUserId, replyToken, text, intent, lu);
    return;
  }

  // (2) 名前での呼びかけ／直前の「〜に聞く」（連携済みのみ）
  if (lu.userId) {
    const personas = await loadPersonas(lu.userId);
    const addressed = detectAddressedAgent(text, personas);
    const pendingAsk = lu.state.note?.startsWith("ask:") ? lu.state.note.slice(4) : null;
    const asked: AgentKey | null = pendingAsk && (AGENTS as readonly string[]).includes(pendingAsk) ? (pendingAsk as AgentKey) : null;
    const agent = addressed ?? asked;
    if (agent) {
      if (pendingAsk) await saveLineState(lineUserId, { ...lu.state, note: undefined });
      // 呼びかけ＋依頼（「ケイ、論理パズル出して」）は会話に渡し、出題への近道ボタンを添える
      const wantsTask = intent.kind === "quiz" || intent.kind === "generate" || intent.kind === "domain";
      await handleChat(lineUserId, replyToken, text, lu.userId, agent, scheduleAfter, { offerQuiz: wantsTask });
      return;
    }
  }

  // (3) 既知の意図
  if (intent.kind === "quiz") {
    await handleQuiz(lineUserId, replyToken, lu, intent.domain);
    return;
  }
  if (intent.kind === "generate") {
    await handleGenerate(lineUserId, replyToken, lu, intent.request, scheduleAfter);
    return;
  }
  // 連携済みなら、短いコマンド（「READ」「今日のおすすめ」「履歴」など）だけをルールベースで扱い、
  // 長い自由文（「本を読むのが好きなんだけど…」）は人格との会話に回す（会話の自由度を優先）
  const isShortCommand = text.trim().length <= LINE.commandMaxChars;
  if (intent.kind !== "unknown" && (!lu.userId || isShortCommand)) {
    await handleRuleBasedMessage(lineUserId, replyToken, text, intent, lu);
    return;
  }

  // (4) 残りの自由文: 連携済みなら案内役との会話、未連携は従来のルールベース（連携案内つき）
  if (lu.userId) {
    await handleChat(lineUserId, replyToken, text, lu.userId, "LEADER", scheduleAfter, { offerQuiz: false });
    return;
  }
  await handleRuleBasedMessage(lineUserId, replyToken, text, intent, lu);
}

/** 4 人格との会話。先に受け付けを返し、after() で生成して push する。 */
async function handleChat(
  lineUserId: string,
  replyToken: string,
  text: string,
  userId: string,
  agent: AgentKey,
  scheduleAfter: AfterScheduler,
  opts: { offerQuiz: boolean },
): Promise<void> {
  const personas = await loadPersonas(userId);
  if (rateLimit(`line-chat:${userId}`, CHAT_LIMIT.count, CHAT_LIMIT.windowMs)) {
    await replyTo(replyToken, {
      text: `${personas[agent].name}: 少し話しすぎかも。10 分ほど休憩してからまた呼んで。問題を解くのは今すぐでも大丈夫。`,
      quickReplies: [{ type: "postback", label: "今日の学習", data: "action=today", displayText: "今日の学習" }],
    }).catch((err) => console.warn("[line] reply failed:", (err as Error).message));
    return;
  }
  // LLM（＋Web 検索）は数秒かかるので、先に受け付けを返し、after() で生成して push する
  await replyTo(replyToken, { text: `${personas[agent].name}: 考えています…` }).catch((err) =>
    console.warn("[line] reply failed:", (err as Error).message),
  );
  scheduleAfter(async () => {
    try {
      const result = await chatWithAgent(userId, agent, text);
      const reply = await chatReply(userId, env.appUrl, result, { offerQuiz: opts.offerQuiz });
      await pushTo(lineUserId, reply).catch((err) => console.warn("[line] push failed:", (err as Error).message));
    } catch (err) {
      console.warn("[line] chat failed:", (err as Error).message);
      await pushTo(lineUserId, {
        text: "いまは答えられませんでした。「今日の学習」で 1 問どうぞ。",
        quickReplies: await agentQuickReplies(userId, env.appUrl).catch(() => []),
      }).catch(() => undefined);
    }
  });
}

/** LINE 上の選択式出題。 */
async function handleQuiz(lineUserId: string, replyToken: string, lu: LineUser, domain: DomainKey | null): Promise<void> {
  if (!lu.userId) {
    await replyTo(replyToken, needLinkReply());
    return;
  }
  const reply = await startQuiz(lu.userId, lineUserId, lu.state, domain);
  await replyTo(replyToken, reply);
}

/** 自由文の作問依頼。即時返信後に生成し、push で届ける。 */
async function handleGenerate(
  lineUserId: string,
  replyToken: string,
  lu: LineUser,
  request: string,
  scheduleAfter: AfterScheduler,
): Promise<void> {
  if (!lu.userId) {
    await replyTo(replyToken, needLinkReply());
    return;
  }
  const userId = lu.userId;
  if (rateLimit(`line-generate:${userId}`, GENERATE_LIMIT.count, GENERATE_LIMIT.windowMs)) {
    await replyTo(replyToken, {
      text: "作問はしばらくお休み（10 分に 6 問まで）。用意してある問題なら今すぐ出せます。",
      quickReplies: [{ type: "postback", label: "今日の学習", data: "action=today", displayText: "今日の学習" }],
    }).catch((err) => console.warn("[line] reply failed:", (err as Error).message));
    return;
  }
  // reply が失敗（token 失効など）しても作問は続け、push で届ける
  await replyTo(replyToken, generatingReply(request)).catch((err) => console.warn("[line] reply failed:", (err as Error).message));
  scheduleAfter(async () => {
    try {
      const reply = await generateAndBuildPush(userId, lineUserId, lu.state, request);
      await pushTo(lineUserId, reply).catch((err) => console.warn("[line] push failed:", (err as Error).message));
    } catch (err) {
      console.warn("[line] generate failed:", (err as Error).message);
      await pushTo(lineUserId, {
        text: "今回は作れませんでした。通常の出題なら下のボタンからどうぞ。",
        quickReplies: [{ type: "postback", label: "今日の学習", data: "action=today", displayText: "今日の学習" }],
      }).catch(() => undefined);
    }
  });
}

async function handleRuleBasedMessage(lineUserId: string, replyToken: string, text: string, intent: Intent, lu: LineUser): Promise<void> {
  const linkUrl = await prepareLink(lineUserId, lu.userId, intent.kind);
  // 連携解除: 返信前に実際に解除する（返信文は解除前の状態に基づく）
  if (intent.kind === "unlink" && lu.userId) await unlinkLineUser(lineUserId);
  const reply = buildReply(text, await contextFor(lu, linkUrl));
  // 返信APIが失敗しても状態は残るよう、先に保存する
  await persist(lineUserId, lu.state, reply);
  await replyTo(replyToken, reply);
}

async function handlePostback(lineUserId: string, replyToken: string, data: string, scheduleAfter: AfterScheduler): Promise<void> {
  const lu = await loadLineUser(lineUserId);
  const params = new URLSearchParams(data);
  const action = params.get("action") ?? "";

  if (action === "today" || action === "quiz") {
    const raw = params.get("domain") ?? "";
    const domain: DomainKey | null = action === "quiz" ? (parseDomain(raw) ?? domainOf(raw)) : null;
    await handleQuiz(lineUserId, replyToken, lu, domain);
    return;
  }
  if (action === "answer" || action === "giveup") {
    await handleAnswer(lineUserId, replyToken, lu, action, params, scheduleAfter);
    return;
  }
  if (action === "ask") {
    await handleAsk(lineUserId, replyToken, lu, params);
    return;
  }
  await handleRuleBasedPostback(lineUserId, replyToken, data, action, lu);
}

/** 回答・ギブアップ。決着返信の後に集計し、push する順序を守る。 */
async function handleAnswer(
  lineUserId: string,
  replyToken: string,
  lu: LineUser,
  action: "answer" | "giveup",
  params: URLSearchParams,
  scheduleAfter: AfterScheduler,
): Promise<void> {
  if (!lu.userId) {
    await replyTo(replyToken, needLinkReply());
    return;
  }
  const userId = lu.userId;
  const taskId = params.get("task") ?? "";
  const choice = Number(params.get("choice") ?? "-1");

  // 出題中の問題（pendingTask）と一致しない回答は、古い出題のボタンなので受け付けない
  const pending = lu.state.pendingTask;
  if (!pending || pending.taskId !== taskId) {
    await replyTo(replyToken, {
      text: "その問題は終わっています。「今日の学習」で新しい問題を出します。",
      quickReplies: [
        { type: "postback", label: "今日の学習", data: "action=today", displayText: "今日の学習" },
        { type: "uri", label: "Dashboard", uri: `${env.appUrl.replace(/\/$/, "")}/dashboard` },
      ],
    });
    return;
  }

  const outcome =
    action === "giveup"
      ? await giveUpQuiz(userId, lineUserId, lu.state, taskId)
      : await answerQuiz(userId, lineUserId, lu.state, taskId, choice);

  // reply が失敗しても決着後の集計は必ず回す（記録は既に付いている）
  await replyTo(replyToken, outcome.reply).catch((err) => console.warn("[line] reply failed:", (err as Error).message));
  if (!outcome.settled) return;
  const { domain } = outcome.settled;
  scheduleAfter(async () => {
    try {
      const reply = await settleAndBuildPush(userId, domain);
      await pushTo(lineUserId, reply).catch((err) => console.warn("[line] push failed:", (err as Error).message));
      // 今日の 3 問がそろった瞬間のミッション Flex は日次総評（digest）に一本化する（二重送信を避ける）
      await notifyDailyDigestIfComplete(userId);
    } catch (err) {
      console.warn("[line] settle failed:", (err as Error).message);
      // 記録は付いているので、集計だけ失敗したことを伝えて Dashboard へ誘導する
      await saveLineState(lineUserId, withPendingTask(lu.state, null)).catch(() => undefined);
      await pushTo(lineUserId, {
        text: "集計に失敗しました。記録は保存されています。Dashboard で確認してください。",
        buttons: {
          title: "集計に失敗",
          text: "Dashboard で確認できます",
          actions: [{ type: "uri", label: "Dashboard を開く", uri: `${env.appUrl.replace(/\/$/, "")}/dashboard` }],
        },
      }).catch(() => undefined);
    }
  });
}

/** 「〜に聞く」: 次の自由文を指定人格宛てにする。 */
async function handleAsk(lineUserId: string, replyToken: string, lu: LineUser, params: URLSearchParams): Promise<void> {
  if (!lu.userId) {
    await replyTo(replyToken, needLinkReply());
    return;
  }
  const raw = params.get("agent") ?? "LEADER";
  const agent: AgentKey = (AGENTS as readonly string[]).includes(raw) ? (raw as AgentKey) : "LEADER";
  const personas = await loadPersonas(lu.userId);
  await saveLineState(lineUserId, { ...lu.state, note: `ask:${agent}` });
  await replyTo(replyToken, askPrompt(agent, personas[agent].name));
}

async function handleRuleBasedPostback(lineUserId: string, replyToken: string, data: string, action: string, lu: LineUser): Promise<void> {
  const linkUrl = await prepareLink(lineUserId, lu.userId, action === "link" ? "link" : "other");
  const ctx = await contextFor(lu, linkUrl);
  // プロフィール: 連携済みなら Flex カード（ランク・XP・到達レベル・ミッション）
  if (action === "profile" && lu.userId) {
    await replyFlex(replyToken, "プロフィール", await buildProfileCard(lu.userId, "あなた"));
    return;
  }
  const reply = buildPostbackReply(data, ctx);
  await persist(lineUserId, lu.state, reply);
  await replyTo(replyToken, reply);
}

/** 連携要求（message / postback 共通）: 未連携なら 15 分有効のワンタイムURLを発行する。 */
async function prepareLink(lineUserId: string, linkedUserId: string | null, intentKind: string): Promise<string | undefined> {
  if (intentKind !== "link" || linkedUserId) return undefined;
  const issued = await issueLinkToken(lineUserId);
  return `${env.appUrl.replace(/\/$/, "")}/link/${issued.token}`;
}

/** 連携済みなら保存済みの Leader プロフィールと能力スコアを添える。PII は読まない。 */
async function contextFor(lu: LineUser, linkUrl?: string): Promise<LeaderContext> {
  let leaderProfile: LeaderContext["leaderProfile"] = null;
  let scores: LeaderContext["scores"];
  if (lu.userId) {
    const [profile, domains] = await Promise.all([
      prisma.leaderProfile.findUnique({ where: { userId: lu.userId } }),
      prisma.domainProfile.findMany({
        where: { userId: lu.userId },
        select: { domain: true, score: true, evidenceCount: true, confidence: true },
      }),
    ]);
    if (profile) {
      const preferences = (profile.preferences ?? {}) as Record<string, unknown>;
      const recommendedDomain = typeof preferences.recommendedDomain === "string" ? (preferences.recommendedDomain as DomainKey) : null;
      leaderProfile = { summary: profile.summary, recommendation: profile.recommendation, recommendedDomain };
    }
    scores = domains.map((profile) => ({
      domain: profile.domain as DomainKey,
      score: profile.score,
      evidenceCount: profile.evidenceCount,
      confidence: profile.confidence,
    }));
  }
  return { state: lu.state, appUrl: env.appUrl, leaderProfile, linked: Boolean(lu.userId), linkUrl, scores };
}

async function persist(lineUserId: string, state: LineState, reply: LeaderReply): Promise<void> {
  let next = state;
  if (reply.suggestedDomain) next = noteSuggestion(next, reply.suggestedDomain);
  if (reply.note) next = { ...next, note: reply.note };
  if (next !== state) await saveLineState(lineUserId, next);
}
