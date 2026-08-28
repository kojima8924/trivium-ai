// 学習者の出題設定（出さない問題タイプ・複合問題の可否）の読み書き。
// LeaderProfile.preferences（Json）に excludedTaskTypes / excludeComposite として保存する（migration 不要）。
// ADVISOR の再計算（src/lib/profile.ts）が preferences を書き換えるときも、この 2 キーは引き継がれる。
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { DEFAULT_TASK_PREFS, parseTaskPrefs, type TaskPrefs } from "./task-types";

export const TASK_PREF_KEYS = ["excludedTaskTypes", "excludeComposite", "notify"] as const;

/** 保存済みの出題設定（未設定なら既定＝全部出す） */
export async function loadTaskPrefs(userId: string): Promise<TaskPrefs> {
  const row = await prisma.leaderProfile.findUnique({ where: { userId }, select: { preferences: true } });
  if (!row) return DEFAULT_TASK_PREFS;
  return parseTaskPrefs(row.preferences);
}

/** 出題設定を保存する（他の preferences キーは残す） */
export async function saveTaskPrefs(userId: string, prefs: TaskPrefs): Promise<TaskPrefs> {
  const clean = parseTaskPrefs(prefs);
  const row = await prisma.leaderProfile.findUnique({ where: { userId }, select: { preferences: true } });
  const current = (row?.preferences && typeof row.preferences === "object" && !Array.isArray(row.preferences) ? row.preferences : {}) as Record<string, unknown>;
  const preferences = { ...current, excludedTaskTypes: clean.excludedTaskTypes, excludeComposite: clean.excludeComposite } as Prisma.InputJsonValue;
  await prisma.leaderProfile.upsert({
    where: { userId },
    update: { preferences },
    create: { userId, preferences },
  });
  return clean;
}

/** preferences を丸ごと書き換える処理から呼ぶ: 出題設定のキーだけ既存から引き継ぐ */
export function carryTaskPrefs(existing: unknown, next: Record<string, unknown>): Record<string, unknown> {
  const cur = (existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}) as Record<string, unknown>;
  const out = { ...next };
  for (const k of TASK_PREF_KEYS) if (k in cur && !(k in out)) out[k] = cur[k];
  return out;
}
