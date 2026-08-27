// エージェントの観察メモ（AgentMemory）。
// メモ整形の純粋部分は memory.pure.ts に置く。
//   - READ / WRITE / CODE の人格は、自分の系統で決着した 1 問ごとにメモを書き直す
//   - LEADER は 3 系統のメモ＋直近の総評から自分のメモを書き直す
//   - 本人には見せない内部用。数値は書かせない（数値は決定論の集計が正本）
//   - 失敗しても学習ループを止めない（呼び出し側は catch。ここでも上限・数値除去の後処理を必ず通す）
import "server-only";
import { EXTERNAL } from "@/config/trivium.config";
import { prisma } from "./prisma";
import { learningAI } from "./ai";
import type { DomainKey } from "./domain";
import { personaPrompts, type AgentKey } from "./persona";
import { answerExcerpt, sanitizeNotes } from "./memory.pure";

type SettledEventForMemory = {
  taskTitle: string;
  domain: DomainKey;
  axes: { read: number; write: number; code: number };
  success: boolean;
  hintCount: number;
  answer: string;
};

export async function getMemory(userId: string, agent: AgentKey): Promise<string> {
  const row = await prisma.agentMemory.findUnique({ where: { userId_agent: { userId, agent } } });
  return row?.notes ?? "";
}

export async function getAllMemories(userId: string): Promise<Record<AgentKey, string>> {
  const rows = await prisma.agentMemory.findMany({ where: { userId } });
  const out: Record<AgentKey, string> = { READ: "", WRITE: "", CODE: "", LEADER: "" };
  for (const r of rows) if (r.agent in out) out[r.agent as AgentKey] = r.notes;
  return out;
}

async function saveMemory(userId: string, agent: AgentKey, notes: string): Promise<void> {
  await prisma.agentMemory.upsert({
    where: { userId_agent: { userId, agent } },
    update: { notes },
    create: { userId, agent, notes },
  });
}

/**
 * 決着した 1 問を踏まえて、その系統の人格のメモを書き直す。
 * 呼び出し側（finalize 等）は `void updateMemoryAfterEvent(...).catch(() => undefined)` で待たずに呼ぶ。
 */
export async function updateMemoryAfterEvent(userId: string, domain: DomainKey, ev: SettledEventForMemory): Promise<string> {
  const [previousNotes, personas] = await Promise.all([getMemory(userId, domain), personaPrompts(userId)]);
  const out = await learningAI.updateMemory({
    learnerRef: userId,
    agent: domain,
    persona: personas[domain],
    previousNotes,
    event: {
      taskTitle: ev.taskTitle,
      domain: ev.domain,
      axes: ev.axes,
      success: ev.success,
      hintCount: ev.hintCount,
      answerExcerpt: answerExcerpt(ev.answer),
    },
    maxChars: EXTERNAL.agentMemoryMaxChars,
  });
  const notes = sanitizeNotes(out.notes);
  await saveMemory(userId, domain, notes);
  return notes;
}

/** LEADER のメモを 3 系統のメモ＋直近の総評から書き直す */
export async function updateLeaderMemory(userId: string): Promise<string> {
  const [all, personas, leader] = await Promise.all([
    getAllMemories(userId),
    personaPrompts(userId),
    prisma.leaderProfile.findUnique({ where: { userId }, select: { summary: true } }),
  ]);
  const out = await learningAI.updateMemory({
    learnerRef: userId,
    agent: "LEADER",
    persona: personas.LEADER,
    previousNotes: all.LEADER,
    domainNotes: (["READ", "WRITE", "CODE"] as const).map((a) => ({ agent: a, notes: all[a] })),
    leaderSummary: leader?.summary ?? "",
    maxChars: EXTERNAL.agentMemoryMaxChars,
  });
  const notes = sanitizeNotes(out.notes);
  await saveMemory(userId, "LEADER", notes);
  return notes;
}
