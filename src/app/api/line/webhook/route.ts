// LINE Messaging API Webhook
// - 署名検証必須（x-line-signature / channel secret の HMAC-SHA256）
// - LINE 表面に出すのは Leader だけ。課題は Web へ誘導する
// - イベント単位で try/catch し、1件失敗しても 200 を返す（LINE の再送嵐を防ぐ）
import { NextResponse } from "next/server";
import { messagingApi, validateSignature, type webhook } from "@line/bot-sdk";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { loadLineUser, noteSuggestion, saveLineState, type LineState } from "@/lib/line/state";
import {
  buildPostbackReply,
  buildReply,
  classifyIntent,
  welcomeReply,
  type LeaderAction,
  type LeaderContext,
  type LeaderReply,
} from "@/lib/line/leader";
import { issueLinkToken, unlinkLineUser } from "@/lib/line/link";
import type { DomainKey } from "@/lib/domain";

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

  const client = new messagingApi.MessagingApiClient({ channelAccessToken: env.line.channelAccessToken });
  const events = Array.isArray(payload.events) ? payload.events : [];

  // LINE は 1秒程度で応答を期待するので、イベント処理は並列で行う
  await Promise.all(
    events.map(async (event) => {
      try {
        await handleEvent(client, event);
      } catch (err) {
        console.error("[line] event failed:", (err as Error).message);
      }
    }),
  );

  return NextResponse.json({ ok: true, handled: events.length });
}

async function handleEvent(client: messagingApi.MessagingApiClient, event: webhook.Event): Promise<void> {
  const lineUserId = event.source?.type === "user" ? event.source.userId : undefined;
  if (!lineUserId) return; // グループ/ルームは対象外

  if (event.type === "follow") {
    const lu = await loadLineUser(lineUserId);
    const ctx = await contextFor(lu);
    await reply(client, event.replyToken, welcomeReply(ctx));
    return;
  }

  if (event.type === "message") {
    if (event.message.type !== "text" || !event.replyToken) return;
    const lu = await loadLineUser(lineUserId);
    const text = event.message.text;
    const intent = classifyIntent(text);

    const linkUrl = await prepareLink(lineUserId, lu.userId, intent.kind);
    // 連携解除: 返信前に実際に解除する（返信文は解除前の状態に基づく）
    if (intent.kind === "unlink" && lu.userId) {
      await unlinkLineUser(lineUserId);
    }

    const ctx = await contextFor(lu, linkUrl);
    const r = buildReply(text, ctx);
    // 返信APIが失敗しても状態は残るよう、先に保存する
    await persist(lineUserId, lu.state, r);
    await reply(client, event.replyToken, r);
    return;
  }

  if (event.type === "postback") {
    if (!event.replyToken) return;
    const lu = await loadLineUser(lineUserId);
    // Rich Menu の postback（action=link）からも連携URLを発行できるようにする
    const action = new URLSearchParams(event.postback.data).get("action");
    const linkUrl = await prepareLink(lineUserId, lu.userId, action === "link" ? "link" : "other");
    const ctx = await contextFor(lu, linkUrl);
    const r = buildPostbackReply(event.postback.data, ctx);
    await persist(lineUserId, lu.state, r);
    await reply(client, event.replyToken, r);
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

// ---- LeaderReply → LINE メッセージ ----

function toAction(a: LeaderAction): messagingApi.Action {
  switch (a.type) {
    case "uri":
      return { type: "uri", label: a.label.slice(0, 20), uri: a.uri };
    case "message":
      return { type: "message", label: a.label.slice(0, 20), text: a.text };
    case "postback":
      return { type: "postback", label: a.label.slice(0, 20), data: a.data, displayText: a.displayText };
  }
}

function toMessages(r: LeaderReply): messagingApi.Message[] {
  const messages: messagingApi.Message[] = [];
  const text: messagingApi.TextMessage = { type: "text", text: r.text.slice(0, 5000) };
  if (r.quickReplies?.length) {
    text.quickReply = { items: r.quickReplies.slice(0, 13).map((a) => ({ type: "action", action: toAction(a) })) };
  }
  messages.push(text);
  if (r.buttons) {
    messages.push({
      type: "template",
      altText: r.buttons.title,
      template: {
        type: "buttons",
        title: r.buttons.title.slice(0, 40),
        text: r.buttons.text.slice(0, 60),
        actions: r.buttons.actions.slice(0, 4).map(toAction),
      },
    });
  }
  return messages;
}

async function reply(client: messagingApi.MessagingApiClient, replyToken: string | undefined, r: LeaderReply) {
  if (!replyToken) return;
  await client.replyMessage({ replyToken, messages: toMessages(r) });
}
