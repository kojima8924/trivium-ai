// Dify の Chatflow（4 人格 + 教材おすすめを 1 本にまとめたもの）から呼ぶ学習者コンテキスト。
// 「人格の設定・能力値（決定論の live 計算）・直近の履歴・出題中の課題・会話ログ」を 1 回の HTTP で返す。
// 数値はすべて既存の集計（liveDomainStats / computeXp / recommendDifficulty）を使い、ここでは新しい計算をしない。
import "server-only";
import { prisma } from "@/lib/prisma";
import { DOMAINS, type DomainKey } from "@/lib/domain";
import { liveDomainStats, loadEvents, subskillsOf } from "@/lib/profile";
import { recommendDifficulty } from "@/lib/scoring";
import { computeXp } from "@/lib/xp";
import { loadPersonas, AGENTS, type AgentKey } from "@/lib/persona";
import { resolveTask } from "@/lib/learn/service";
import { getTask } from "@/lib/tasks";
import { parseLineState } from "@/lib/line/state";
import { AI_SYSTEM_POLICY } from "@/lib/ai/types";
import {
  displayNameOf,
  formatPersona,
  orderRecentChat,
  pickRecommendedDomain,
  publicCurrentTask,
  subskillLabel,
  weakestSubskillOf,
  type AgentContext,
  type AgentDomainProfileOut,
  type AgentPersonaOut,
} from "./agent-context.pure";

export type { AgentContext } from "./agent-context.pure";

const RECENT_EVENTS = 5;
const RECENT_CHAT = 8;

/** 学習者 1 人分のコンテキスト。ユーザーが存在しなければ null */
export async function buildAgentContext(userId: string, now: Date = new Date()): Promise<AgentContext | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  if (!user) return null;

  // ローカル PG（PGlite）は並列に弱いので 2 段に分ける
  const [personas, profiles, leader] = await Promise.all([
    loadPersonas(userId),
    prisma.domainProfile.findMany({ where: { userId } }),
    prisma.leaderProfile.findUnique({ where: { userId }, select: { preferences: true } }),
  ]);
  const [events, recentEventRows, chatRows, lineUsers] = await Promise.all([
    loadEvents(userId),
    prisma.learningEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_EVENTS,
      select: { taskId: true, domain: true, difficulty: true, success: true, hintCount: true, createdAt: true },
    }),
    prisma.chatTurn.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_CHAT,
      select: { agent: true, role: true, text: true },
    }),
    prisma.lineUser.findMany({ where: { userId }, select: { state: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }),
  ]);

  const live = liveDomainStats(events, now);
  const xp = computeXp(events, now);

  const profile = {} as Record<DomainKey, AgentDomainProfileOut>;
  const levels = {} as Record<DomainKey, number>;
  const evidence = {} as Record<DomainKey, number>;
  for (const d of DOMAINS) {
    const s = live[d];
    const row = profiles.find((p) => p.domain === d);
    // 弱い小分類は保存済み subskills を優先（寸評と同じ根拠）。無ければ live の集計
    const subs = row ? subskillsOf(row.subskills) : s.subskills;
    const weakest = weakestSubskillOf(subs);
    levels[d] = s.level;
    evidence[d] = s.evidenceCount;
    profile[d] = {
      level: s.level,
      score: s.score,
      evidenceCount: s.evidenceCount,
      confidence: s.confidence,
      weakestSubskill: weakest,
      weakestSubskillLabel: subskillLabel(weakest),
      summary: row?.summary ?? "",
      recommendedNext: row?.recommendedNext ?? "",
    };
  }

  const prefs = (leader?.preferences ?? {}) as Record<string, unknown>;
  const storedDomain = typeof prefs.recommendedDomain === "string" ? prefs.recommendedDomain : null;
  const recommendedDomain = pickRecommendedDomain(storedDomain, levels, evidence);

  // LINE 側の状態（出題中の課題・勧めた教材）。複数連携があれば新しい方を優先
  const states = lineUsers.map((l) => parseLineState(l.state));
  const pending = states.find((s) => s.pendingTask)?.pendingTask ?? null;
  const materialsSeen = [...new Set(states.flatMap((s) => s.recommendedMaterialIds ?? []))];
  const currentTask = pending ? publicCurrentTask(await resolveTask(userId, pending.taskId)) : null;

  const personasOut = Object.fromEntries(AGENTS.map((a) => [a, formatPersona(personas[a])])) as Record<AgentKey, AgentPersonaOut>;

  // AI 作問（gen-…）の題名は静的カタログに無いので、直近イベント分だけ引く
  const genIds = recentEventRows.map((e) => e.taskId).filter((id) => id.startsWith("gen-"));
  const genTitles = new Map<string, string>();
  if (genIds.length > 0) {
    const rows = await prisma.generatedTask.findMany({ where: { userId, id: { in: genIds } }, select: { id: true, title: true } });
    for (const r of rows) genTitles.set(r.id, r.title);
  }

  return {
    learner: { ref: user.id, displayName: displayNameOf(user.name) },
    personas: personasOut,
    profile,
    recommendedDomain,
    recommendedDifficulty: recommendDifficulty(recommendedDomain, events, now),
    xp: { total: xp.total, rank: xp.rank.title, streak: xp.streak, missionToday: xp.missionToday },
    recentEvents: recentEventRows.map((e) => ({
      taskId: e.taskId,
      domain: e.domain as DomainKey,
      title: getTask(e.taskId)?.title ?? genTitles.get(e.taskId) ?? e.taskId,
      difficulty: e.difficulty,
      success: e.success,
      hintCount: e.hintCount,
      at: e.createdAt.toISOString(),
    })),
    currentTask,
    recentChat: orderRecentChat(chatRows, RECENT_CHAT),
    materialsSeen,
    policy: [...AI_SYSTEM_POLICY],
  };
}
