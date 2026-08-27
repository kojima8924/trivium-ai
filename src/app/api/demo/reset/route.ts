import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { rateLimit, rejectCrossSite } from "@/lib/http";

export const dynamic = "force-dynamic";

// POST /api/demo/reset
// ログイン中ユーザーの学習状態を初期状態に戻す（events / profiles / leader / achievements / 挑戦 / 生成課題 / スナップショット）。
// アカウント自体・人格設定・LINE 連携は残す。
export async function POST(req: Request) {
  if (!env.demoSeedEnabled) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limited = rateLimit(`reset:${userId}`, 6, 60_000);
  if (limited) return limited;

  // LINE 側の「回答待ち」「パス済み」「難易度指定」も初期化する（初期化後に古い出題へ回答できてしまうのを防ぐ）
  const lineUsers = await prisma.lineUser.findMany({ where: { userId }, select: { id: true, state: true } });
  const lineUpdates = lineUsers.map((lu) => {
    const { pendingTask: _p, passedTaskIds: _q, preferredDifficulty: _r, note: _n, ...rest } = (lu.state ?? {}) as Record<string, unknown>;
    void _p;
    void _q;
    void _r;
    void _n;
    return prisma.lineUser.update({ where: { id: lu.id }, data: { state: rest as object } });
  });
  const results = await prisma.$transaction([
    ...lineUpdates,
    prisma.learningEvent.deleteMany({ where: { userId } }),
    prisma.domainProfile.deleteMany({ where: { userId } }),
    prisma.leaderProfile.deleteMany({ where: { userId } }),
    prisma.achievement.deleteMany({ where: { userId } }),
    prisma.taskAttempt.deleteMany({ where: { userId } }),
    prisma.generatedTask.deleteMany({ where: { userId } }),
    prisma.profileSnapshot.deleteMany({ where: { userId } }),
    prisma.dailyDigest.deleteMany({ where: { userId } }),
  ]);
  const events = results[lineUpdates.length] as { count: number };
  return NextResponse.json({ ok: true, removedEvents: events.count });
}
