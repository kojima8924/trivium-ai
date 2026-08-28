import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { rateLimit, rejectCrossSite } from "@/lib/http";
import { loadNotifyPrefs, saveNotifyPrefs } from "@/lib/notify-prefs";
import { parseNotifyPrefs } from "@/lib/notify.pure";

export const dynamic = "force-dynamic";

// GET  /api/settings/notifications  … ログイン中ユーザーの通知設定
// POST /api/settings/notifications  … 保存（lastReminderDay はサーバ側の管理値なので受け付けない）
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await loadNotifyPrefs(userId));
}

export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limited = rateLimit(`notify-prefs:${userId}`, 20, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const prefs = parseNotifyPrefs(body);
  const saved = await saveNotifyPrefs(userId, {
    reminderEnabled: prefs.reminderEnabled,
    reminderTime: prefs.reminderTime,
    digestEnabled: prefs.digestEnabled,
  });
  return NextResponse.json(saved);
}
