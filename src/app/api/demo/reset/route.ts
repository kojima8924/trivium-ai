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

  const [events] = await prisma.$transaction([
    prisma.learningEvent.deleteMany({ where: { userId } }),
    prisma.domainProfile.deleteMany({ where: { userId } }),
    prisma.leaderProfile.deleteMany({ where: { userId } }),
    prisma.achievement.deleteMany({ where: { userId } }),
    prisma.taskAttempt.deleteMany({ where: { userId } }),
    prisma.generatedTask.deleteMany({ where: { userId } }),
    prisma.profileSnapshot.deleteMany({ where: { userId } }),
    prisma.dailyDigest.deleteMany({ where: { userId } }),
  ]);
  return NextResponse.json({ ok: true, removedEvents: events.count });
}
