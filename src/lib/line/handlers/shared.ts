// LINE ハンドラの共通部品（server-only）。
// 意図別のハンドラ（handlers/quiz.ts / chat.ts / rule.ts）と入口の handlers.ts から使う。
import "server-only";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { DomainKey } from "@/lib/domain";
import { needLinkReply } from "../quiz";
import { replyTo } from "../push";
import { noteSuggestion, saveLineState, type LineState, type loadLineUser } from "../state";
import type { LeaderContext, LeaderReply } from "../types";

export type LineUser = Awaited<ReturnType<typeof loadLineUser>>;
export type AfterScheduler = (task: () => void | Promise<void>) => void;

/** LINE 経由の LLM 呼び出しの利用者単位の上限（Web API の制限を迂回させない） */
export const CHAT_LIMIT = { count: 20, windowMs: 10 * 60_000 };
export const GENERATE_LIMIT = { count: 6, windowMs: 10 * 60_000 };

export const warn = (label: string) => (err: unknown) => console.warn(`[line] ${label}:`, (err as Error).message);

/** 未連携なら案内を返して null（出題・記録には連携が必要） */
export async function requireLinked(lu: LineUser, replyToken: string): Promise<string | null> {
  if (lu.userId) return lu.userId;
  await replyTo(replyToken, needLinkReply());
  return null;
}

/** 連携済みなら保存済みの Leader プロフィールと能力スコアを添える。PII は読まない。 */
export async function contextFor(lu: LineUser, linkUrl?: string): Promise<LeaderContext> {
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

/** 返信に付いてきた状態の変化（おすすめ系統・メモ）を保存する */
export async function persist(lineUserId: string, state: LineState, reply: LeaderReply): Promise<void> {
  let next = state;
  if (reply.suggestedDomain) next = noteSuggestion(next, reply.suggestedDomain);
  if (reply.note) next = { ...next, note: reply.note };
  if (next !== state) await saveLineState(lineUserId, next);
}

/** LLM 呼び出しに上限時間を付ける（LINE の reply token は 1 分で失効するため） */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
