// LINE ↔ Web アカウントの連携。
// LINE 側から短命のワンタイムURLを発行し、Web でログイン中のユーザーが開くと結びつく。
// トークンは推測不能・単回・15分で失効。PII は保存しない。
import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TTL_MINUTES = 15;

export type LinkIssue = { token: string; expiresInMinutes: number };

/** 使用済み・期限切れのトークンを掃除する（発行のついでに呼ぶ。件数は小さい） */
async function sweepStaleTokens(now: Date): Promise<void> {
  await prisma.lineLinkToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
  });
}

/** LINE 側で連携URLを発行する（同じLINEユーザーの未使用トークンは無効化する） */
export async function issueLinkToken(lineUserId: string): Promise<LinkIssue> {
  const now = new Date();
  await sweepStaleTokens(now);
  await prisma.lineLinkToken.deleteMany({ where: { lineUserId, usedAt: null } });
  const token = randomBytes(24).toString("base64url");
  await prisma.lineLinkToken.create({
    data: { token, lineUserId, expiresAt: new Date(now.getTime() + TTL_MINUTES * 60_000) },
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

export type LinkStatus = LinkOutcome["status"];

/**
 * Web 側でトークンを消費して連携する。
 * 単回性は「未使用かつ期限内の行を updateMany で使用済みにできたか（count === 1）」だけで判定する。
 * 読み取り→更新の間に別リクエストが割り込んでも、更新に成功するのは1件だけ。
 */
export async function consumeLinkToken(token: string, userId: string): Promise<LinkOutcome> {
  const now = new Date();
  const claimed = await prisma.lineLinkToken.updateMany({
    where: { token, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });

  if (claimed.count !== 1) {
    // 消費できなかった理由を返すためだけに読む（ここでの読み取り結果は状態を変えない）
    const row = await prisma.lineLinkToken.findUnique({ where: { token } });
    if (!row) return { status: "invalid" };
    if (row.usedAt) return { status: "used" };
    return { status: "expired" };
  }

  const row = await prisma.lineLinkToken.findUnique({ where: { token } });
  if (!row) return { status: "invalid" }; // 消費直後に掃除されたケース（実質起きない）

  const existing = await prisma.lineUser.findUnique({ where: { lineUserId: row.lineUserId } });
  const previousUserId = existing?.userId ?? null;

  await prisma.$transaction([
    prisma.lineUser.upsert({
      where: { lineUserId: row.lineUserId },
      update: { userId },
      create: { lineUserId: row.lineUserId, userId, state: {} },
    }),
    // 同じLINEユーザーの他の未使用トークンも無効化する
    prisma.lineLinkToken.deleteMany({ where: { lineUserId: row.lineUserId, usedAt: null } }),
  ]);

  if (previousUserId === userId) return { status: "already" };
  if (previousUserId) return { status: "relinked" };
  return { status: "linked" };
}

/**
 * 結果画面を出す前の裏取り。
 * 「そのトークンが存在し、使用済みで、LINE ユーザーがログイン中のユーザーに紐づいている」ときだけ true。
 * URL のクエリだけで成功画面が出ないようにするための検査で、状態は変えない。
 */
export async function isLinkResultGenuine(token: string, userId: string): Promise<boolean> {
  const row = await prisma.lineLinkToken.findUnique({ where: { token }, select: { usedAt: true, lineUserId: true } });
  if (!row || !row.usedAt) return false;
  const lu = await prisma.lineUser.findUnique({ where: { lineUserId: row.lineUserId }, select: { userId: true } });
  return lu?.userId === userId;
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
