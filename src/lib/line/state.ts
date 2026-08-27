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

/** domain を案内したときに呼ぶ（純粋関数: 新しい state を返す） */
export function noteSuggestion(state: LineState, domain: DomainKey, now: Date = new Date()): LineState {
  const counts = { ...(state.counts ?? emptyCounts()) };
  counts[domain] = (counts[domain] ?? 0) + 1;
  return { ...state, lastDomain: domain, lastSuggestedAt: now.toISOString(), counts };
}
