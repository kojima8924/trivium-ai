// 通知設定（リマインダー・総評）の読み書き。
// LeaderProfile.preferences（Json）の "notify" キーに保存する（migration 不要）。
// src/lib/task-prefs.ts と同じ流儀。ADVISOR の再計算が preferences を書き換えるときは
// carryNotifyPrefs で "notify" キーを引き継ぐこと（引き継がないと設定が消える）。
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { DEFAULT_NOTIFY_PREFS, NOTIFY_PREFS_KEY, notifyPrefsFromPreferences, parseNotifyPrefs, type NotifyPrefs } from "./notify.pure";

export const NOTIFY_PREF_KEYS = [NOTIFY_PREFS_KEY] as const;

/** 保存済みの通知設定（未設定なら既定） */
export async function loadNotifyPrefs(userId: string): Promise<NotifyPrefs> {
  const row = await prisma.leaderProfile.findUnique({ where: { userId }, select: { preferences: true } });
  if (!row) return DEFAULT_NOTIFY_PREFS;
  return notifyPrefsFromPreferences(row.preferences);
}

/** 通知設定を保存する（他の preferences キーは残す。lastReminderDay は指定が無ければ現状維持） */
export async function saveNotifyPrefs(userId: string, next: Partial<NotifyPrefs>): Promise<NotifyPrefs> {
  const row = await prisma.leaderProfile.findUnique({ where: { userId }, select: { preferences: true } });
  const current = (row?.preferences && typeof row.preferences === "object" && !Array.isArray(row.preferences) ? row.preferences : {}) as Record<string, unknown>;
  const merged = parseNotifyPrefs({ ...notifyPrefsFromPreferences(current), ...next });
  const preferences = { ...current, [NOTIFY_PREFS_KEY]: merged } as Prisma.InputJsonValue;
  await prisma.leaderProfile.upsert({
    where: { userId },
    update: { preferences },
    create: { userId, preferences },
  });
  return merged;
}

/** リマインダーを送った日を記録する（同じ日の二重送信を防ぐ） */
export async function markReminderSent(userId: string, day: string): Promise<void> {
  await saveNotifyPrefs(userId, { lastReminderDay: day });
}

/** preferences を丸ごと書き換える処理から呼ぶ: 通知設定のキーだけ既存から引き継ぐ */
export function carryNotifyPrefs(existing: unknown, next: Record<string, unknown>): Record<string, unknown> {
  const cur = (existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}) as Record<string, unknown>;
  const out = { ...next };
  for (const k of NOTIFY_PREF_KEYS) if (k in cur && !(k in out)) out[k] = cur[k];
  return out;
}
