// AI の人格（READ / WRITE / CODE(LOGIC) / LEADER）。
// 呼びかけ判定の純粋部分は persona.pure.ts に置く。
// 既定と口調プリセットは src/config/trivium.config.ts に置き、ユーザーごとの上書きを DB（AgentPersona）に保存する。
// prompt に載せる整形（PersonaPrompt）と、講評キャッシュのキー（personaKey）をここで作る。
import "server-only";
import { createHash } from "node:crypto";
import { PERSONA_DEFAULTS, TONE_PRESETS, type ToneKey } from "@/config/trivium.config";
import { prisma } from "./prisma";
import type { PersonaPrompt } from "./ai/types";

export const AGENTS = ["READ", "WRITE", "CODE", "LEADER"] as const;
export type AgentKey = (typeof AGENTS)[number];

export const TONES = TONE_PRESETS;
export type { ToneKey };

export type PersonaConfig = {
  agent: AgentKey;
  name: string;
  tone: ToneKey;
  firstPerson: string;
  extra: string;
};

export const DEFAULT_PERSONAS: Record<AgentKey, PersonaConfig> = {
  READ: pick(PERSONA_DEFAULTS.READ),
  WRITE: pick(PERSONA_DEFAULTS.WRITE),
  CODE: pick(PERSONA_DEFAULTS.CODE),
  LEADER: pick(PERSONA_DEFAULTS.LEADER),
};

function pick(d: (typeof PERSONA_DEFAULTS)[AgentKey]): PersonaConfig {
  return { agent: d.agent, name: d.name, tone: d.tone, firstPerson: d.firstPerson, extra: d.extra };
}

export const AGENT_LABELS: Record<AgentKey, string> = {
  READ: "READ（読む）",
  WRITE: "WRITE（書く）",
  CODE: "LOGIC（論理）",
  LEADER: "LEADER（総合）",
};

function isTone(v: string): v is ToneKey {
  return v in TONE_PRESETS;
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
    tone: TONE_PRESETS[cfg.tone].prompt,
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
