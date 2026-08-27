// LINE ユーザーの軽い状態（LineUser.state Json）の読み書きヘルパ。
// Web アカウントとは独立して動く（userId は将来の連携用で任意）。
import "server-only";
import { prisma } from "@/lib/prisma";
import { DOMAINS, type DomainKey } from "@/lib/domain";

export type LineState = {
  /** 直近に案内した domain */
  lastDomain?: DomainKey;
  /** 直近に提案を出した時刻（ISO） */
  lastSuggestedAt?: string;
  /** LINE 経由で各 domain を案内した回数（「最近CODEが多い」の判断材料） */
  counts?: Record<DomainKey, number>;
  /** 自由メモ（「5分だけ」などの直近の文脈） */
  note?: string;
  /** LINE 上で出題中の課題（回答待ち） */
  pendingTask?: { taskId: string; domain: DomainKey; sentAt: string };
  /** 直近に本人が指定した難易度（1〜10）。「次」「もう1問」でも文脈として引き継ぐ（同じ系統・3 時間以内だけ） */
  preferredDifficulty?: number;
  /** 難易度を指定したときの系統（別系統には持ち越さない）。null は系統未指定 */
  preferredDifficultyDomain?: DomainKey | null;
  /** 難易度を指定した時刻（ISO）。古い指定は無視する */
  preferredDifficultyAt?: string;
  /** LINE で「パス」した課題（記録は付けず、しばらく再出題しない。直近 50 件） */
  passedTaskIds?: string[];
};

export function emptyCounts(): Record<DomainKey, number> {
  return { READ: 0, WRITE: 0, CODE: 0 };
}

/** Json → LineState（不正値は捨てる） */
export function parseLineState(json: unknown): LineState {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const o = json as Record<string, unknown>;
  const state: LineState = {};
  if (typeof o.lastDomain === "string" && (DOMAINS as readonly string[]).includes(o.lastDomain)) {
    state.lastDomain = o.lastDomain as DomainKey;
  }
  if (typeof o.lastSuggestedAt === "string") state.lastSuggestedAt = o.lastSuggestedAt;
  if (o.counts && typeof o.counts === "object" && !Array.isArray(o.counts)) {
    const c = o.counts as Record<string, unknown>;
    const counts = emptyCounts();
    for (const d of DOMAINS) if (typeof c[d] === "number") counts[d] = c[d] as number;
    state.counts = counts;
  }
  if (typeof o.note === "string") state.note = o.note.slice(0, 200);
  if (typeof o.preferredDifficulty === "number" && o.preferredDifficulty >= 1 && o.preferredDifficulty <= 10) {
    state.preferredDifficulty = Math.round(o.preferredDifficulty);
    if (typeof o.preferredDifficultyDomain === "string" && (DOMAINS as readonly string[]).includes(o.preferredDifficultyDomain)) {
      state.preferredDifficultyDomain = o.preferredDifficultyDomain as DomainKey;
    } else if (o.preferredDifficultyDomain === null) {
      state.preferredDifficultyDomain = null;
    }
    if (typeof o.preferredDifficultyAt === "string") state.preferredDifficultyAt = o.preferredDifficultyAt;
  }
  if (Array.isArray(o.passedTaskIds)) {
    state.passedTaskIds = o.passedTaskIds.filter((x): x is string => typeof x === "string").slice(-50);
  }
  if (o.pendingTask && typeof o.pendingTask === "object" && !Array.isArray(o.pendingTask)) {
    const t = o.pendingTask as Record<string, unknown>;
    if (
      typeof t.taskId === "string" &&
      typeof t.domain === "string" &&
      (DOMAINS as readonly string[]).includes(t.domain) &&
      typeof t.sentAt === "string"
    ) {
      state.pendingTask = { taskId: t.taskId, domain: t.domain as DomainKey, sentAt: t.sentAt };
    }
  }
  return state;
}

/** LINE user を upsert して state を返す */
export async function loadLineUser(lineUserId: string): Promise<{ id: string; userId: string | null; state: LineState }> {
  const row = await prisma.lineUser.upsert({
    where: { lineUserId },
    update: {},
    create: { lineUserId, state: {} },
    select: { id: true, userId: true, state: true },
  });
  return { id: row.id, userId: row.userId, state: parseLineState(row.state) };
}

export async function saveLineState(lineUserId: string, state: LineState): Promise<void> {
  await prisma.lineUser.update({
    where: { lineUserId },
    data: { state: { ...state } },
  });
}

/** 難易度指定を記録する（純粋関数） */
export function withPreferredDifficulty(state: LineState, difficulty: number | undefined, domain: DomainKey | null, now: Date = new Date()): LineState {
  const { preferredDifficulty: _d, preferredDifficultyDomain: _dm, preferredDifficultyAt: _at, ...rest } = state;
  void _d;
  void _dm;
  void _at;
  if (difficulty === undefined) return rest;
  return { ...rest, preferredDifficulty: difficulty, preferredDifficultyDomain: domain, preferredDifficultyAt: now.toISOString() };
}

/** 有効な難易度指定（同じ系統、または系統未指定の指定で、3 時間以内）だけ返す */
export function activePreferredDifficulty(state: LineState, domain: DomainKey | null, now: Date = new Date()): number | undefined {
  if (state.preferredDifficulty === undefined) return undefined;
  const at = state.preferredDifficultyAt ? Date.parse(state.preferredDifficultyAt) : NaN;
  if (Number.isFinite(at) && now.getTime() - at > 3 * 60 * 60 * 1000) return undefined;
  const pd = state.preferredDifficultyDomain;
  if (pd && domain && pd !== domain) return undefined;
  return state.preferredDifficulty;
}

/** 「パス」した課題を記録する（純粋関数。直近 50 件） */
export function withPassedTask(state: LineState, taskId: string): LineState {
  const ids = [...(state.passedTaskIds ?? []).filter((id) => id !== taskId), taskId].slice(-50);
  return { ...state, passedTaskIds: ids };
}

/** 出題中の課題を記録/解除する（純粋関数） */
export function withPendingTask(state: LineState, pending: LineState["pendingTask"] | null, now: Date = new Date()): LineState {
  const next: LineState = { ...state };
  if (pending) next.pendingTask = { ...pending, sentAt: pending.sentAt || now.toISOString() };
  else delete next.pendingTask;
  return next;
}

/** domain を案内したときに呼ぶ（純粋関数: 新しい state を返す） */
export function noteSuggestion(state: LineState, domain: DomainKey, now: Date = new Date()): LineState {
  const counts = { ...(state.counts ?? emptyCounts()) };
  counts[domain] = (counts[domain] ?? 0) + 1;
  return { ...state, lastDomain: domain, lastSuggestedAt: now.toISOString(), counts };
}
