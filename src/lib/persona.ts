// AI の人格（READ / WRITE / CODE(LOGIC) / LEADER）。ユーザーごとに名前・口調・一人称・補足を上書きできる。
// prompt に載せる整形（PersonaPrompt）と、講評キャッシュのキー（personaKey）をここで作る。
import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import type { PersonaPrompt } from "./ai/types";

export const AGENTS = ["READ", "WRITE", "CODE", "LEADER"] as const;
export type AgentKey = (typeof AGENTS)[number];

export const TONES = {
  polite: { label: "丁寧", prompt: "落ち着いた敬体。相手を急かさず、短い問いで考えを引き出す" },
  casual: { label: "フランク", prompt: "くだけた話し言葉（です・ます は少なめ）。軽やかだが茶化さない" },
  senior: { label: "先輩", prompt: "少し先を歩く先輩の口調。経験談を一言だけ添え、答えは渡さない" },
  coach: { label: "コーチ", prompt: "簡潔で前向き。事実→次の一手の順で話し、感情表現は控えめ" },
} as const;
export type ToneKey = keyof typeof TONES;

export type PersonaConfig = {
  agent: AgentKey;
  name: string;
  tone: ToneKey;
  firstPerson: string;
  extra: string;
};

export const DEFAULT_PERSONAS: Record<AgentKey, PersonaConfig> = {
  READ: { agent: "READ", name: "アオイ", tone: "polite", firstPerson: "私", extra: "文章の根拠を本文の言葉で確かめさせる" },
  WRITE: { agent: "WRITE", name: "フミ", tone: "senior", firstPerson: "わたし", extra: "書き手の主張を尊重し、構成と根拠だけを問う" },
  CODE: { agent: "CODE", name: "ケイ", tone: "coach", firstPerson: "僕", extra: "値を一つずつ追わせる。答えは絶対に言わない" },
  LEADER: { agent: "LEADER", name: "リード", tone: "polite", firstPerson: "私", extra: "3領域を横断して見る。数字は集計値だけを使う" },
};

export const AGENT_LABELS: Record<AgentKey, string> = {
  READ: "READ（読む）",
  WRITE: "WRITE（書く）",
  CODE: "LOGIC（論理）",
  LEADER: "LEADER（総合）",
};

function isTone(v: string): v is ToneKey {
  return v in TONES;
}

/** ユーザーの人格設定（未設定分は既定で埋める） */
export async function loadPersonas(userId: string): Promise<Record<AgentKey, PersonaConfig>> {
  const rows = await prisma.agentPersona.findMany({ where: { userId } });
  const out = { ...DEFAULT_PERSONAS };
  for (const r of rows) {
    if (!(AGENTS as readonly string[]).includes(r.agent)) continue;
    const agent = r.agent as AgentKey;
    out[agent] = {
      agent,
      name: r.name.trim() || DEFAULT_PERSONAS[agent].name,
      tone: isTone(r.tone) ? r.tone : DEFAULT_PERSONAS[agent].tone,
      firstPerson: r.firstPerson.trim() || DEFAULT_PERSONAS[agent].firstPerson,
      extra: r.extra.trim().slice(0, 200),
    };
  }
  return out;
}

export async function savePersona(userId: string, cfg: PersonaConfig): Promise<void> {
  await prisma.agentPersona.upsert({
    where: { userId_agent: { userId, agent: cfg.agent } },
    update: { name: cfg.name, tone: cfg.tone, firstPerson: cfg.firstPerson, extra: cfg.extra },
    create: { userId, agent: cfg.agent, name: cfg.name, tone: cfg.tone, firstPerson: cfg.firstPerson, extra: cfg.extra },
  });
}

export async function resetPersonas(userId: string): Promise<void> {
  await prisma.agentPersona.deleteMany({ where: { userId } });
}

/** prompt 用に整形する。key は設定内容のハッシュ（講評キャッシュの分離に使う） */
export function toPrompt(cfg: PersonaConfig): PersonaPrompt {
  const key = createHash("sha1")
    .update(`${cfg.agent}|${cfg.name}|${cfg.tone}|${cfg.firstPerson}|${cfg.extra}`)
    .digest("hex")
    .slice(0, 12);
  return {
    agent: cfg.agent,
    name: cfg.name,
    tone: TONES[cfg.tone].prompt,
    firstPerson: cfg.firstPerson,
    extra: cfg.extra,
    key,
  };
}

/** domain 用と Leader 用をまとめて prompt 形式で取る */
export async function personaPrompts(userId: string): Promise<Record<AgentKey, PersonaPrompt>> {
  const cfgs = await loadPersonas(userId);
  return {
    READ: toPrompt(cfgs.READ),
    WRITE: toPrompt(cfgs.WRITE),
    CODE: toPrompt(cfgs.CODE),
    LEADER: toPrompt(cfgs.LEADER),
  };
}
