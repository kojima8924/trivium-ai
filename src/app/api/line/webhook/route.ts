// LINE Messaging API Webhook
// - 署名検証必須（x-line-signature / channel secret の HMAC-SHA256）
// - LINE 表面に出すのは Leader と各人格の講評だけ。じっくり書く課題は Web へ誘導する
// - 選択式の出題・回答は LINE 上で完結（採点は決定論、講評はキャッシュ）
// - 時間のかかる処理（作問・決着後の集計）は after() でレスポンス後に回し、push で届ける
// - イベント単位で try/catch し、1件失敗しても 200 を返す（LINE の再送嵐を防ぐ）
import { NextResponse } from "next/server";
import { after } from "next/server";
import { validateSignature, type webhook } from "@line/bot-sdk";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { loadLineUser, noteSuggestion, saveLineState, type LineState } from "@/lib/line/state";
import { buildPostbackReply, buildReply, classifyIntent, domainOf, welcomeReply, type LeaderContext, type LeaderReply } from "@/lib/line/leader";
import { issueLinkToken, unlinkLineUser } from "@/lib/line/link";
import { pushTo, replyTo, replyFlex } from "@/lib/line/push";
import {
  answerQuiz,
  generateAndBuildPush,
  generatingReply,
  giveUpQuiz,
  needLinkReply,
  settleAndBuildPushFull,
  buildProfileCard,
  startQuiz,
} from "@/lib/line/quiz";
import { notifyDailyDigestIfComplete } from "@/lib/learn/digest";
import { AGENTS, loadPersonas, type AgentKey } from "@/lib/persona";
import { detectAddressedAgent } from "@/lib/persona-address";
import { agentQuickReplies, askPrompt, chatReply, chatWithAgent } from "@/lib/line/chat";
import { parseDomain, type DomainKey } from "@/lib/domain";

export const dynamic = "force-dynamic";

// 疎通確認用（LINE Developers の「検証」ボタンは POST なので、こちらは人間用）
export async function GET() {
  return NextResponse.json({ ok: true, configured: Boolean(env.line.channelSecret && env.line.channelAccessToken) });
}

export async function POST(req: Request) {
  if (!env.line.channelSecret || !env.line.channelAccessToken) {
    return NextResponse.json({ error: "LINE is not configured" }, { status: 503 });
  }

  // 署名検証は raw body に対して行う（JSON 化前）
  const body = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  if (!signature || !validateSignature(body, env.line.channelSecret, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: webhook.CallbackRequest;
  try {
    payload = JSON.parse(body) as webhook.CallbackRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];

  // LINE は 1秒程度で応答を期待するので、イベント処理は並列で行う
  await Promise.all(
    events.map(async (event) => {
      try {
        await handleEvent(event);
      } catch (err) {
        console.error("[line] event failed:", (err as Error).message);
      }
    }),
  );

  return NextResponse.json({ ok: true, handled: events.length });
}

async function handleEvent(event: webhook.Event): Promise<void> {
  const lineUserId = event.source?.type === "user" ? event.source.userId : undefined;
  if (!lineUserId) return; // グループ/ルームは対象外

  if (event.type === "follow") {
    const lu = await loadLineUser(lineUserId);
    const ctx = await contextFor(lu);
    await replyTo(event.replyToken, welcomeReply(ctx));
    return;
  }

  if (event.type === "message") {
    if (event.message.type !== "text" || !event.replyToken) return;
    const lu = await loadLineUser(lineUserId);
    const text = event.message.text;
    const intent = classifyIntent(text);

    // ---- 4 人格との会話（連携済み）----
    // 宛先: 呼びかけ（「ケイ、〜」）> 直前の「〜に聞く」> 案内役。呼びかけがあれば意図分類より優先する
    // （「ケイ、順番の問題が苦手」を出題コマンドと誤認しないため）。連携/解除/ヘルプはコマンドとして先に処理する
    if (lu.userId && !["link", "unlink", "help"].includes(intent.kind)) {
      const userId = lu.userId;
      const personas = await loadPersonas(userId);
      const pendingAsk = lu.state.note?.startsWith("ask:") ? lu.state.note.slice(4) : null;
      const addressed = detectAddressedAgent(text, personas);
      const asked: AgentKey | null = pendingAsk && (AGENTS as readonly string[]).includes(pendingAsk) ? (pendingAsk as AgentKey) : null;
      if (addressed || asked || intent.kind === "unknown") {
        const agent: AgentKey = addressed ?? asked ?? "LEADER";
        if (pendingAsk) await saveLineState(lineUserId, { ...lu.state, note: undefined });
        // LLM（＋Web 検索）は数秒かかるので、先に受け付けを返し、after() で生成して push する
        await replyTo(event.replyToken, { text: `${personas[agent].name}: 考えています…` }).catch((err) => console.warn("[line] reply failed:", (err as Error).message));
        after(async () => {
          try {
            const result = await chatWithAgent(userId, agent, text);
            const r = await chatReply(userId, env.appUrl, result);
            await pushTo(lineUserId, r).catch((err) => console.warn("[line] push failed:", (err as Error).message));
          } catch (err) {
            console.warn("[line] chat failed:", (err as Error).message);
            await pushTo(lineUserId, { text: "いまは答えられませんでした。「今日の学習」で 1 問どうぞ。", quickReplies: await agentQuickReplies(userId, env.appUrl) }).catch(() => undefined);
          }
        });
        return;
      }
    }

    // ---- LINE 上で完結する出題・作問（連携が必要） ----
    if (intent.kind === "quiz") {
      if (!lu.userId) return replyTo(event.replyToken, needLinkReply());
      const r = await startQuiz(lu.userId, lineUserId, lu.state, intent.domain);
      return replyTo(event.replyToken, r);
    }
    if (intent.kind === "generate") {
      if (!lu.userId) return replyTo(event.replyToken, needLinkReply());
      const userId = lu.userId;
      // reply が失敗（token 失効など）しても作問は続け、push で届ける
      await replyTo(event.replyToken, generatingReply(intent.request)).catch((err) => console.warn("[line] reply failed:", (err as Error).message));
      after(async () => {
        const r = await generateAndBuildPush(userId, lineUserId, lu.state, intent.request);
        await pushTo(lineUserId, r).catch((err) => console.warn("[line] push failed:", (err as Error).message));
      });
      return;
    }

    // ---- ルールベースの会話 ----
    const linkUrl = await prepareLink(lineUserId, lu.userId, intent.kind);
    // 連携解除: 返信前に実際に解除する（返信文は解除前の状態に基づく）
    if (intent.kind === "unlink" && lu.userId) {
      await unlinkLineUser(lineUserId);
    }
    const ctx = await contextFor(lu, linkUrl);
    const r = buildReply(text, ctx);
    // 返信APIが失敗しても状態は残るよう、先に保存する
    await persist(lineUserId, lu.state, r);
    await replyTo(event.replyToken, r);
    return;
  }

  if (event.type === "postback") {
    if (!event.replyToken) return;
    const lu = await loadLineUser(lineUserId);
    const params = new URLSearchParams(event.postback.data);
    const action = params.get("action") ?? "";

    // ---- 出題 / 回答（連携が必要） ----
    if (action === "today" || action === "quiz") {
      if (!lu.userId) return replyTo(event.replyToken, needLinkReply());
      const raw = params.get("domain") ?? "";
      const domain: DomainKey | null = action === "quiz" ? (parseDomain(raw) ?? domainOf(raw)) : null;
      const r = await startQuiz(lu.userId, lineUserId, lu.state, domain);
      return replyTo(event.replyToken, r);
    }
    if (action === "answer" || action === "giveup") {
      if (!lu.userId) return replyTo(event.replyToken, needLinkReply());
      const userId = lu.userId;
      const taskId = params.get("task") ?? "";
      const choice = Number(params.get("choice") ?? "-1");
      const outcome =
        action === "giveup"
          ? await giveUpQuiz(userId, lineUserId, lu.state, taskId)
          : await answerQuiz(userId, lineUserId, lu.state, taskId, choice);
      // reply が失敗しても決着後の集計は必ず回す（記録は既に付いている）
      await replyTo(event.replyToken, outcome.reply).catch((err) => console.warn("[line] reply failed:", (err as Error).message));
      if (outcome.settled) {
        const { domain } = outcome.settled;
        after(async () => {
          const r = await settleAndBuildPushFull(userId, domain);
          await pushTo(lineUserId, r.reply).catch((err) => console.warn("[line] push failed:", (err as Error).message));
          // 今日の 3 問がそろった瞬間のミッション Flex は日次総評（digest）に一本化する（二重送信を避ける）
          await notifyDailyDigestIfComplete(userId);
        });
      }
      return;
    }

    // ---- 「〜に聞く」: 次の自由文をその人格宛てにする（連携が必要） ----
    if (action === "ask") {
      if (!lu.userId) return replyTo(event.replyToken, needLinkReply());
      const raw = params.get("agent") ?? "LEADER";
      const agent: AgentKey = (AGENTS as readonly string[]).includes(raw) ? (raw as AgentKey) : "LEADER";
      const personas = await loadPersonas(lu.userId);
      await saveLineState(lineUserId, { ...lu.state, note: `ask:${agent}` });
      return replyTo(event.replyToken, askPrompt(agent, personas[agent].name));
    }

    // ---- ルールベース（履歴 / プロフィール / 連携 / 領域選択） ----
    const linkUrl = await prepareLink(lineUserId, lu.userId, action === "link" ? "link" : "other");
    const ctx = await contextFor(lu, linkUrl);
    // プロフィール: 連携済みなら Flex カード（ランク・XP・到達レベル・ミッション）
    if (action === "profile" && lu.userId) {
      const card = await buildProfileCard(lu.userId, "あなた");
      await replyFlex(event.replyToken, "プロフィール", card);
      return;
    }
    const r = buildPostbackReply(event.postback.data, ctx);
    await persist(lineUserId, lu.state, r);
    await replyTo(event.replyToken, r);
    return;
  }
  // それ以外（unfollow 等）は無視
}

/** 連携要求（message / postback 共通）: 未連携なら 15 分有効のワンタイムURLを発行する */
async function prepareLink(lineUserId: string, linkedUserId: string | null, intentKind: string): Promise<string | undefined> {
  if (intentKind !== "link" || linkedUserId) return undefined;
  const issued = await issueLinkToken(lineUserId);
  return `${env.appUrl.replace(/\/$/, "")}/link/${issued.token}`;
}

/**
 * Web アカウント連携済み（LineUser.userId あり）なら、保存済みの Leader プロフィールと
 * 能力スコアを添える。氏名・メールなどの PII は一切読まない。
 */
async function contextFor(lu: { id: string; userId: string | null; state: LineState }, linkUrl?: string): Promise<LeaderContext> {
  let leaderProfile: { summary: string; recommendation: string; recommendedDomain: DomainKey | null } | null = null;
  let scores: LeaderContext["scores"];
  if (lu.userId) {
    const [lp, profiles] = await Promise.all([
      prisma.leaderProfile.findUnique({ where: { userId: lu.userId } }),
      prisma.domainProfile.findMany({
        where: { userId: lu.userId },
        select: { domain: true, score: true, evidenceCount: true, confidence: true },
      }),
    ]);
    if (lp) {
      const prefs = (lp.preferences ?? {}) as Record<string, unknown>;
      const rd = typeof prefs.recommendedDomain === "string" ? (prefs.recommendedDomain as DomainKey) : null;
      leaderProfile = { summary: lp.summary, recommendation: lp.recommendation, recommendedDomain: rd };
    }
    scores = profiles.map((p) => ({
      domain: p.domain as DomainKey,
      score: p.score,
      evidenceCount: p.evidenceCount,
      confidence: p.confidence,
    }));
  }
  return { state: lu.state, appUrl: env.appUrl, leaderProfile, linked: Boolean(lu.userId), linkUrl, scores };
}

async function persist(lineUserId: string, state: LineState, r: LeaderReply): Promise<void> {
  let next = state;
  if (r.suggestedDomain) next = noteSuggestion(next, r.suggestedDomain);
  if (r.note) next = { ...next, note: r.note };
  if (next !== state) await saveLineState(lineUserId, next);
}
