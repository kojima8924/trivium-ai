// ルールベースの返信（LLM を使わない定型）と連携まわりのハンドラ。
// 文面そのものは replies.ts が持ち、ここでは DB 参照・連携トークン発行・保存だけを行う。
import "server-only";
import { prisma } from "@/lib/prisma";
import { replyFlex, replyTo } from "../push";
import { appUrlBase } from "../actions";
import { issueLinkToken, unlinkLineUser } from "../link";
import { buildPostbackReply, buildReply, confirmUnlinkReply } from "../replies";
import { buildProfileCard } from "../quiz";
import type { Intent } from "../types";
import { contextFor, persist, type LineUser } from "./shared";

export async function handleRuleBasedMessage(lineUserId: string, replyToken: string, text: string, intent: Intent, lu: LineUser): Promise<void> {
  // 連携済みの「プロフィール」「能力」はテキストでも Flex カード（リッチメニューの PROFILE と同じ）
  if (intent.kind === "profile" && lu.userId) {
    const u = await prisma.user.findUnique({ where: { id: lu.userId }, select: { name: true } });
    await replyFlex(replyToken, "プロフィール", await buildProfileCard(lu.userId, u?.name ? `${u.name}さん` : "あなた"));
    return;
  }
  const linkUrl = await prepareLink(lineUserId, lu.userId, intent.kind);
  // 連携解除はテキストでは実行しない（確認ボタン action=unlink&confirm=1 で行う）。未連携の「連携解除」は案内文だけ
  const reply = buildReply(text, await contextFor(lu, linkUrl));
  // 返信APIが失敗しても状態は残るよう、先に保存する
  await persist(lineUserId, lu.state, reply);
  await replyTo(replyToken, reply);
}

export async function handleRuleBasedPostback(lineUserId: string, replyToken: string, data: string, action: string, lu: LineUser): Promise<void> {
  const linkUrl = await prepareLink(lineUserId, lu.userId, action === "link" ? "link" : "other");
  const ctx = await contextFor(lu, linkUrl);
  // プロフィール: 連携済みなら Flex カード（ランク・XP・到達レベル・ミッション）
  if (action === "profile" && lu.userId) {
    // 表示名は Web アカウントの名前＋「さん」（未設定なら「あなた」）
    const u = await prisma.user.findUnique({ where: { id: lu.userId }, select: { name: true } });
    await replyFlex(replyToken, "プロフィール", await buildProfileCard(lu.userId, u?.name ? `${u.name}さん` : "あなた"));
    return;
  }
  const reply = buildPostbackReply(data, ctx);
  await persist(lineUserId, lu.state, reply);
  await replyTo(replyToken, reply);
}

/** 連携解除（確認ボタン経由だけ実際に解除する） */
export async function handleUnlink(lineUserId: string, replyToken: string, lu: LineUser, confirmed: boolean): Promise<void> {
  const ctx = await contextFor(lu);
  if (!confirmed || !lu.userId) {
    await replyTo(replyToken, confirmUnlinkReply(ctx));
    return;
  }
  await unlinkLineUser(lineUserId);
  // 返信文は解除前の状態（linked=true）に基づく「解除しました」
  await replyTo(replyToken, buildReply("連携解除", ctx));
}

/** 連携要求（message / postback 共通）: 未連携なら 15 分有効のワンタイムURLを発行する。 */
async function prepareLink(lineUserId: string, linkedUserId: string | null, intentKind: string): Promise<string | undefined> {
  if (intentKind !== "link" || linkedUserId) return undefined;
  const issued = await issueLinkToken(lineUserId);
  return `${appUrlBase()}/link/${issued.token}`;
}
