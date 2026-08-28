// LINE webhook の入口（server-only）。HTTP 契約と署名検証は route.ts が担当する。
// ここではイベントの種類ごとの振り分けだけを行い、実処理は handlers/ 配下に置く:
//   handlers/quiz.ts … 出題・作問・ヒント・パス・回答     handlers/chat.ts … 会話・「〜と話す」
//   handlers/rule.ts … ルールベース返信・連携・解除        handlers/shared.ts … 共通部品
//
// テキストの振り分けは handlers.pure.ts の routeMessage（純粋関数）で決める:
//   (0) 人格の名前での呼びかけ → その人格との会話
//   (1) link / help / unlink（unlink は確認ボタン）
//   (2) 直前に「〜と話す」を押していた（30 分以内） → その人格との会話。短いコマンドはコマンド優先
//   (3) quiz / generate / pass
//   (4) その他の既知の意図 → 未連携、または短いコマンドならルールベース
//   (5) 残り → 連携済みなら案内役（LEADER）との会話、未連携はルールベース（連携案内つき）
import "server-only";
import { LINE } from "@/config/trivium.config";
import type { webhook } from "@line/bot-sdk";
import { learningAI } from "@/lib/ai";
import { parseDomain, type DomainKey } from "@/lib/domain";
import { AGENTS, loadPersonas, type AgentKey } from "@/lib/persona";
import { detectAddressedAgent } from "@/lib/persona.pure";
import { classifyIntent, domainOf } from "./intent";
import { intentFromGuess, routeMessage } from "./handlers.pure";
import { handleMaterials } from "./materials";
import { confirmUnlinkReply, welcomeReply } from "./replies";
import { replyTo } from "./push";
import { askedAgentOf, loadLineUser, saveLineState, withoutNote } from "./state";
import type { Intent } from "./types";
import { handleAsk, handleChat } from "./handlers/chat";
import { handleAnswer, handleGenerate, handleHint, handlePass, handleQuiz } from "./handlers/quiz";
import { handleRuleBasedMessage, handleRuleBasedPostback, handleUnlink } from "./handlers/rule";
import { contextFor, requireLinked, withTimeout, type AfterScheduler } from "./handlers/shared";

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
  let intent: Intent = classifyIntent(text);
  const linked = Boolean(lu.userId);
  const addressed = lu.userId ? detectAddressedAgent(text, await loadPersonas(lu.userId)) : null;
  const askedRaw = askedAgentOf(lu.state);
  const askedAgent: AgentKey | null = askedRaw && (AGENTS as readonly string[]).includes(askedRaw) ? (askedRaw as AgentKey) : null;
  const pendingDomain = lu.state.pendingTask?.domain ?? null;
  // 意図判定は LLM を主にする（明示語ではなく意味で分岐。ai-chatbot-system の分類→エスカレーションと同じ考え方）。
  // 正規表現は「パス」「ヒント」「連携」「使い方」などの短い定型コマンドの補助。LLM が失敗・低確信なら正規表現の結果 → 会話へ
  const EXACT_COMMANDS = new Set(["pass", "hint", "link", "unlink", "help"]);
  if (linked && !addressed && learningAI.classifyLineIntent && text.trim().length >= 2 && !EXACT_COMMANDS.has(intent.kind)) {
    const personas = await loadPersonas(lu.userId!);
    const guess = await withTimeout(
      learningAI.classifyLineIntent({ text, linked, pendingTask: Boolean(pendingDomain), personaNames: (["READ", "WRITE", "CODE", "LEADER"] as const).map((a) => personas[a].name) }),
      4000,
    ).catch(() => null);
    const mapped = intentFromGuess(guess, text);
    if (mapped) {
      console.log(`[line] ai-intent ${guess?.kind} (${guess?.confidence?.toFixed(2)}) -> ${mapped.kind} (regex: ${intent.kind})`);
      intent = mapped;
    } else if (guess?.kind === "chat" && guess.confidence >= 0.7 && intent.kind !== "unknown") {
      // 正規表現が拾った語（「読む」「今日」など）が会話の一部だった場合は会話に戻す
      console.log(`[line] ai-intent chat overrides regex ${intent.kind}`);
      intent = { kind: "unknown" };
    }
  }
  const route = routeMessage({ intent, linked, addressed, askedAgent, isShort: text.trim().length <= LINE.commandMaxChars || intent.kind !== "unknown", pendingDomain });
  console.log(`[line] message user=${lineUserId.slice(-6)} linked=${linked} intent=${intent.kind} route=${route.route} len=${text.length}`);

  // 「〜と話す」のメモは、会話に使ったら消す。コマンドを優先したときも消す（次のテキストが横取りされないように）
  if (lu.state.note?.startsWith("ask:") && (route.route !== "chat" || route.consumeAsk)) {
    lu.state = withoutNote(lu.state);
    await saveLineState(lineUserId, lu.state);
  }

  switch (route.route) {
    case "chat":
      await handleChat(lineUserId, replyToken, text, lu.userId!, route.agent, scheduleAfter, {
        offerQuiz: route.offerQuiz,
        pendingTaskId: route.taskHelp ? lu.state.pendingTask?.taskId : undefined,
      });
      return;
    case "hint":
      await handleHint(lineUserId, replyToken, lu);
      return;
    case "unlink_confirm":
      await replyTo(replyToken, confirmUnlinkReply(await contextFor(lu)));
      return;
    case "quiz":
      if (intent.kind === "quiz") {
        await handleQuiz(lineUserId, replyToken, lu, { domain: intent.domain, difficulty: intent.difficulty, delta: intent.difficultyDelta, taskType: intent.taskType, scheduleAfter });
      }
      return;
    case "generate":
      if (intent.kind === "generate") {
        await handleGenerate(lineUserId, replyToken, lu, intent.request, scheduleAfter, { domain: intent.domain, difficulty: intent.difficulty });
      }
      return;
    case "pass":
      await handlePass(lineUserId, replyToken, lu, lu.state.pendingTask?.taskId ?? "", scheduleAfter);
      return;
    case "materials":
      if (intent.kind === "materials") {
        const userId = await requireLinked(lu, replyToken);
        if (!userId) return;
        await handleMaterials(lineUserId, replyToken, { userId, state: lu.state }, { domain: intent.domain, text: intent.text, freeOnly: intent.freeOnly, kind: intent.kind_ ?? null }, scheduleAfter);
      }
      return;
    case "rule":
      await handleRuleBasedMessage(lineUserId, replyToken, text, intent, lu);
      return;
  }
}

async function handlePostback(lineUserId: string, replyToken: string, data: string, scheduleAfter: AfterScheduler): Promise<void> {
  const lu = await loadLineUser(lineUserId);
  const params = new URLSearchParams(data);
  const action = params.get("action") ?? "";

  // 「〜と話す」の宛先メモは、ボタン操作で別の流れに入ったら消す（後日のテキストが会話に横取りされないように）
  if (action !== "ask" && lu.state.note?.startsWith("ask:")) {
    lu.state = withoutNote(lu.state);
    await saveLineState(lineUserId, lu.state);
  }

  if (action === "today" || action === "quiz") {
    const raw = params.get("domain") ?? "";
    const domain: DomainKey | null = action === "quiz" ? (parseDomain(raw) ?? domainOf(raw)) : null;
    await handleQuiz(lineUserId, replyToken, lu, { domain, scheduleAfter });
    return;
  }
  if (action === "answer" || action === "giveup") {
    await handleAnswer(lineUserId, replyToken, lu, action, params, scheduleAfter);
    return;
  }
  if (action === "pass") {
    await handlePass(lineUserId, replyToken, lu, params.get("task") ?? "", scheduleAfter);
    return;
  }
  if (action === "hint") {
    // 出題メッセージの「💡 ヒント」ボタン。テキストの「ヒント」と同じ扱い（一段だけ出す）
    await handleHint(lineUserId, replyToken, lu, params.get("task") ?? "");
    return;
  }
  if (action === "help") {
    await handleRuleBasedMessage(lineUserId, replyToken, "使い方", { kind: "help" }, lu);
    return;
  }
  if (action === "materials") {
    // 「他の候補」「READ の教材」「無料だけ」（postback）
    const userId = await requireLinked(lu, replyToken);
    if (!userId) return;
    const raw = params.get("domain") ?? "";
    const domain: DomainKey | null = parseDomain(raw) ?? domainOf(raw);
    await handleMaterials(
      lineUserId,
      replyToken,
      { userId, state: lu.state },
      { domain, text: params.get("q") ?? "", freeOnly: params.get("free") === "1" || undefined, kind: null, more: params.get("more") === "1" },
      scheduleAfter,
    );
    return;
  }
  if (action === "ask") {
    await handleAsk(lineUserId, replyToken, lu, params);
    return;
  }
  if (action === "unlink") {
    await handleUnlink(lineUserId, replyToken, lu, params.get("confirm") === "1");
    return;
  }
  await handleRuleBasedPostback(lineUserId, replyToken, data, action, lu);
}
