// LINE への push（reply token が無い場面: 作問完了・決着後の集計・日次総評）。
// 送信先は LINE user ID だけ。氏名などの PII は扱わない。
import "server-only";
import { messagingApi } from "@line/bot-sdk";
import { env } from "@/lib/env";
import type { LeaderAction, LeaderReply } from "./leader";

let client: messagingApi.MessagingApiClient | null = null;

export function lineClient(): messagingApi.MessagingApiClient | null {
  if (!env.line.channelAccessToken) return null;
  if (!client) client = new messagingApi.MessagingApiClient({ channelAccessToken: env.line.channelAccessToken });
  return client;
}

export function toAction(a: LeaderAction): messagingApi.Action {
  switch (a.type) {
    case "uri":
      return { type: "uri", label: a.label.slice(0, 20), uri: a.uri };
    case "message":
      return { type: "message", label: a.label.slice(0, 20), text: a.text };
    case "postback":
      return { type: "postback", label: a.label.slice(0, 20), data: a.data, displayText: a.displayText };
  }
}

/** LeaderReply → LINE のメッセージ配列（text + quickReply / buttons テンプレート） */
export function toMessages(r: LeaderReply): messagingApi.Message[] {
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

/** 返信（reply token が有効なとき） */
export async function replyTo(replyToken: string | undefined, r: LeaderReply): Promise<void> {
  const c = lineClient();
  if (!c || !replyToken) return;
  await c.replyMessage({ replyToken, messages: toMessages(r) });
}

/** push（reply token が無い / 使用済みのとき） */
export async function pushTo(lineUserId: string, r: LeaderReply): Promise<void> {
  const c = lineClient();
  if (!c) return;
  await c.pushMessage({ to: lineUserId, messages: toMessages(r) });
}
