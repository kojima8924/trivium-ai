// エージェント向けコンテキスト（/api/agent/context）の組み立てのうち、DB に触らない部分。
// Dify の Chatflow が 1 回の HTTP で「人格・能力値・直近の履歴・出題中の課題」をまとめて読めるようにするための整形。
// server-only を付けない（テストから直接呼ぶ）。答え（answerKey / hints / explanation / rubric）は絶対に含めない。
import { TONE_PRESETS, type ToneKey } from "@/config/trivium.config";
import { DOMAINS, SUBSKILL_LABELS, type DomainKey } from "@/lib/domain";
import type { AgentKey } from "@/lib/persona";
import type { Task } from "@/lib/tasks";

export type AgentPersonaOut = {
  name: string;
  /** 口調の表示名（例: 丁寧） */
  tone: string;
  /** 口調の説明（プロンプトに載せる文） */
  toneDescription: string;
  firstPerson: string;
  extra: string;
};

export type AgentDomainProfileOut = {
  level: number;
  score: number;
  evidenceCount: number;
  confidence: string;
  weakestSubskill: string | null;
  weakestSubskillLabel: string | null;
  summary: string;
  recommendedNext: string;
};

export type AgentCurrentTaskOut = {
  id: string;
  domain: DomainKey;
  title: string;
  difficulty: number;
  passage: string;
  prompt: string;
  choices: string[];
};

export type AgentChatTurnOut = { agent: AgentKey; role: "user" | "assistant"; text: string };

export type AgentContext = {
  learner: { ref: string; displayName: string };
  personas: Record<AgentKey, AgentPersonaOut>;
  profile: Record<DomainKey, AgentDomainProfileOut>;
  recommendedDomain: DomainKey;
  recommendedDifficulty: number;
  xp: { total: number; rank: string; streak: number; missionToday: boolean };
  /** 直近 5 件（新しい順） */
  recentEvents: {
    taskId: string;
    domain: DomainKey;
    title: string;
    difficulty: number;
    success: boolean;
    hintCount: number;
    at: string;
  }[];
  /** LINE で出題中の課題（無ければ null）。答え・ヒント・解説は含めない */
  currentTask: AgentCurrentTaskOut | null;
  /** 直近 8 発話（古い順。全人格をまとめる） */
  recentChat: AgentChatTurnOut[];
  materialsSeen: string[];
  policy: string[];
};

/** 表示名（未設定なら「あなた」） */
export function displayNameOf(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? `${n}さん` : "あなた";
}

type PersonaLike = { name: string; tone: string; firstPerson: string; extra: string };

/** 人格設定 → API 出力（口調はキーではなく表示名＋説明にする。Dify 側でそのままプロンプトに載せられる） */
export function formatPersona(cfg: PersonaLike): AgentPersonaOut {
  const preset = TONE_PRESETS[cfg.tone as ToneKey];
  return {
    name: cfg.name,
    tone: preset?.label ?? cfg.tone,
    toneDescription: preset?.prompt ?? "",
    firstPerson: cfg.firstPerson,
    extra: cfg.extra,
  };
}

export function subskillLabel(key: string | null): string | null {
  if (!key) return null;
  return SUBSKILL_LABELS[key] ?? key;
}

/** 小分類のスコア表から最も弱いものを返す（同点はキー順で安定） */
export function weakestSubskillOf(subskills: Record<string, number>): string | null {
  const entries = Object.entries(subskills);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0][0];
}

/**
 * 新しい順で取った会話ログを「古い順」に直す（Dify に会話の流れとして渡すため）。
 * 不正な role の行は落とす。
 */
export function orderRecentChat(
  rows: { agent: string; role: string; text: string }[],
  limit = 8,
): AgentChatTurnOut[] {
  return rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .slice(0, limit)
    .reverse()
    .map((r) => ({ agent: r.agent as AgentKey, role: r.role as "user" | "assistant", text: r.text }));
}

/** 出題中の課題 → API 出力。答え・ヒント・解説・ルーブリックは載せない */
export function publicCurrentTask(task: Task | null): AgentCurrentTaskOut | null {
  if (!task) return null;
  return {
    id: task.id,
    domain: task.domain,
    title: task.title,
    difficulty: task.difficulty,
    passage: task.passage ?? "",
    prompt: task.prompt,
    choices: task.choices ?? [],
  };
}

/**
 * 次に取り組む系統。ADVISOR が保存した推薦（LeaderProfile.preferences.recommendedDomain）を優先し、
 * 無ければ「未計測 → 到達レベルが低い」順で決定論的に選ぶ。
 */
export function pickRecommendedDomain(
  stored: string | null | undefined,
  levels: Record<DomainKey, number>,
  evidence: Record<DomainKey, number>,
): DomainKey {
  if (stored && (DOMAINS as readonly string[]).includes(stored)) return stored as DomainKey;
  const sorted = [...DOMAINS].sort((a, b) => {
    const ua = evidence[a] === 0 ? 0 : 1;
    const ub = evidence[b] === 0 ? 0 : 1;
    if (ua !== ub) return ua - ub; // 未計測を先に
    return levels[a] - levels[b];
  });
  return sorted[0];
}
