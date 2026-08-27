// LINE ↔ Web アカウントの連携。
// LINE 側から短命のワンタイムURLを発行し、Web でログイン中のユーザーが開くと結びつく。
// トークンは推測不能・単回・15分で失効。PII は保存しない。
import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TTL_MINUTES = 15;

export type LinkIssue = { token: string; expiresInMinutes: number };

/** LINE 側で連携URLを発行する（同じLINEユーザーの未使用トークンは無効化する） */
export async function issueLinkToken(lineUserId: string): Promise<LinkIssue> {
  await prisma.lineLinkToken.deleteMany({ where: { lineUserId, usedAt: null } });
  const token = randomBytes(24).toString("base64url");
  await prisma.lineLinkToken.create({
    data: { token, lineUserId, expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000) },
  });
  return { token, expiresInMinutes: TTL_MINUTES };
}

export type LinkOutcome =
  | { status: "linked" }
  | { status: "relinked" } // 別のWebアカウントに繋ぎ直した
  | { status: "already" } // 同じアカウントに既に連携済み
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "used" };

/** Web 側でトークンを消費して連携する */
export async function consumeLinkToken(token: string, userId: string): Promise<LinkOutcome> {
  const row = await prisma.lineLinkToken.findUnique({ where: { token } });
  if (!row) return { status: "invalid" };
  if (row.usedAt) return { status: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { status: "expired" };

  const existing = await prisma.lineUser.findUnique({ where: { lineUserId: row.lineUserId } });
  const previousUserId = existing?.userId ?? null;

  await prisma.$transaction([
    prisma.lineUser.upsert({
      where: { lineUserId: row.lineUserId },
      update: { userId },
      create: { lineUserId: row.lineUserId, userId, state: {} },
    }),
    prisma.lineLinkToken.update({ where: { token }, data: { usedAt: new Date() } }),
    // 同じLINEユーザーの他の未使用トークンも無効化する
    prisma.lineLinkToken.deleteMany({ where: { lineUserId: row.lineUserId, usedAt: null } }),
  ]);

  if (previousUserId === userId) return { status: "already" };
  if (previousUserId) return { status: "relinked" };
  return { status: "linked" };
}

/** Web 側から連携を解除する */
export async function unlinkLineForUser(userId: string): Promise<number> {
  const r = await prisma.lineUser.updateMany({ where: { userId }, data: { userId: null } });
  return r.count;
}

/** LINE 側から連携を解除する */
export async function unlinkLineUser(lineUserId: string): Promise<boolean> {
  const r = await prisma.lineUser.updateMany({ where: { lineUserId, NOT: { userId: null } }, data: { userId: null } });
  await prisma.lineLinkToken.deleteMany({ where: { lineUserId, usedAt: null } });
  return r.count > 0;
}

/** Web アカウントに紐づく LINE 連携の有無 */
export async function isLinkedToLine(userId: string): Promise<boolean> {
  return (await prisma.lineUser.count({ where: { userId } })) > 0;
}
