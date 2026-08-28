import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { DOMAIN_META, type DomainKey } from "@/lib/domain";
import { loadPersonas } from "@/lib/persona";
import { agentReply } from "@/lib/line/flex";
import { pushTo } from "@/lib/line/push";
import { markReminderSent } from "@/lib/notify-prefs";
import { jstDayAndSlot, notifyPrefsFromPreferences, reminderBody, reminderDecision } from "@/lib/notify.pure";
import type { LeaderAction } from "@/lib/line/leader";

export const dynamic = "force-dynamic";

// POST /api/cron/reminder
//   デイリーミッション（3 系統 1 問ずつ）が今日まだ終わっていない人に、設定した時刻の 30 分枠で
//   ミチ（ADVISOR）から LINE に一声かける。GitHub Actions の cron（毎時 0 分・30 分）から叩く。
//   認証は Cookie ではなく Bearer トークン（CRON_TOKEN）。ブラウザから呼ばせない前提。
const MAX_USERS = 200;

function tokenMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const expected = env.cronToken;
  if (!expected) return NextResponse.json({ error: "cron is not configured" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!given || !tokenMatches(given, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const { day, slot } = jstDayAndSlot(now);
  const start = new Date(Date.parse(`${day}T00:00:00+09:00`));

  // LINE 連携済みのユーザーだけが対象（連携していないと push 先が無い）
  const links = await prisma.lineUser.findMany({
    where: { userId: { not: null } },
    select: { lineUserId: true, userId: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_USERS * 2,
  });
  const lineByUser = new Map<string, string>();
  for (const l of links) if (l.userId && !lineByUser.has(l.userId)) lineByUser.set(l.userId, l.lineUserId);
  const userIds = [...lineByUser.keys()].slice(0, MAX_USERS);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  if (userIds.length === 0) return NextResponse.json({ slot, day, sent, skipped, failed, candidates: 0 });

  const [profiles, events] = await Promise.all([
    prisma.leaderProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, preferences: true } }),
    prisma.learningEvent.findMany({
      where: { userId: { in: userIds }, createdAt: { gte: start } },
      select: { userId: true, axisRead: true, axisWrite: true, axisCode: true },
    }),
  ]);
  const prefsByUser = new Map(profiles.map((p) => [p.userId, notifyPrefsFromPreferences(p.preferences)]));
  const coveredByUser = new Map<string, Set<DomainKey>>();
  for (const e of events) {
    const set = coveredByUser.get(e.userId) ?? new Set<DomainKey>();
    if (e.axisRead > 0) set.add("READ");
    if (e.axisWrite > 0) set.add("WRITE");
    if (e.axisCode > 0) set.add("CODE");
    coveredByUser.set(e.userId, set);
  }

  for (const userId of userIds) {
    const prefs = prefsByUser.get(userId) ?? notifyPrefsFromPreferences(null);
    const covered = [...(coveredByUser.get(userId) ?? new Set<DomainKey>())];
    const decision = reminderDecision({ prefs, covered, linked: true }, slot, day);
    if (!decision.send) {
      skipped++;
      continue;
    }
    try {
      const personas = await loadPersonas(userId);
      const first = decision.remaining[0];
      const quickReplies: LeaderAction[] = [
        { type: "postback", label: "今日の学習", data: "action=today", displayText: "今日の学習" },
        { type: "postback", label: `${DOMAIN_META[first].label}で1問`, data: `action=quiz&domain=${first}`, displayText: `${DOMAIN_META[first].label}で1問` },
        { type: "uri", label: "Dashboard", uri: `${env.appUrl.replace(/\/$/, "")}/dashboard` },
      ];
      await pushTo(
        lineByUser.get(userId)!,
        agentReply("LEADER", personas.LEADER.name, reminderBody(decision.remaining), { appUrl: env.appUrl, mood: "wave", quickReplies }),
      );
      // 送れたことを記録してから次へ（失敗した場合は記録しないので次の枠で再試行される）
      await markReminderSent(userId, day);
      sent++;
    } catch (err) {
      failed++;
      console.warn(`[cron] reminder failed for ${userId.slice(-6)}:`, (err as Error).message);
    }
  }

  console.log(`[cron] reminder slot=${slot} day=${day} sent=${sent} skipped=${skipped} failed=${failed}`);
  return NextResponse.json({ slot, day, sent, skipped, failed, candidates: userIds.length });
}
