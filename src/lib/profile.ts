// learning_events（episodic）→ domain_profiles / leader_profiles（semantic）の再計算。
// 数値は scoring.ts で決定論的に集計し、LLM には寸評（interpretation）だけを任せる。
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { learningAI } from "./ai";
import { DOMAINS, type Confidence, type DomainKey } from "./domain";
import { computeDomainScore, recommendDifficulty, type DomainScore, type ScorableEvent } from "./scoring";
import { getTask } from "./tasks";

const MODE: Record<DomainKey, "read" | "write" | "code"> = { READ: "read", WRITE: "write", CODE: "code" };

export async function loadEvents(userId: string): Promise<(ScorableEvent & { id: string; taskId: string })[]> {
  const rows = await prisma.learningEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      domain: true,
      taskId: true,
      difficulty: true,
      success: true,
      hintCount: true,
      skillTags: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, domain: r.domain as DomainKey }));
}

export function subskillsOf(json: Prisma.JsonValue): Record<string, number> {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(json)) if (typeof v === "number") out[k] = v;
  return out;
}

export function stringsOf(json: Prisma.JsonValue): string[] {
  return Array.isArray(json) ? json.filter((x): x is string => typeof x === "string") : [];
}

/** 1 domain の profile を再計算して保存する（決定論スコア + AI寸評） */
export async function recomputeDomainProfile(userId: string, domain: DomainKey, events?: ScorableEvent[]) {
  const all = events ?? (await loadEvents(userId));
  const stats: DomainScore = computeDomainScore(domain, all);
  const now = Date.now();
  const recentEvents = all
    .filter((e) => e.domain === domain)
    .slice(-8)
    .reverse()
    .map((e) => ({
      taskTitle: getTask((e as { taskId?: string }).taskId ?? "")?.title ?? "(不明な課題)",
      difficulty: e.difficulty,
      success: e.success,
      hintCount: e.hintCount,
      skillTags: e.skillTags,
      daysAgo: Math.round((now - e.createdAt.getTime()) / 86_400_000),
    }));

  const interp = await learningAI.interpretDomain({
    mode: MODE[domain],
    learnerRef: userId,
    stats: {
      score: stats.score,
      subskills: stats.subskills,
      confidence: stats.confidence,
      evidenceCount: stats.evidenceCount,
      successRate: stats.successRate,
      avgHints: stats.avgHints,
      avgDifficulty: stats.avgDifficulty,
    },
    recentEvents,
  });

  const data = {
    score: stats.score,
    subskills: stats.subskills,
    confidence: stats.confidence,
    evidenceCount: stats.evidenceCount,
    summary: interp.summary,
    observations: interp.observations,
    recommendedNext: interp.recommendedNext,
  };
  return prisma.domainProfile.upsert({
    where: { userId_domain: { userId, domain } },
    update: data,
    create: { userId, domain, ...data },
  });
}

/** Leader profile を各 domain profile の要約から再計算する */
export async function recomputeLeaderProfile(userId: string, context?: string) {
  const [profiles, events] = await Promise.all([
    prisma.domainProfile.findMany({ where: { userId } }),
    loadEvents(userId),
  ]);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const domains = DOMAINS.map((d) => {
    const p = profiles.find((x) => x.domain === d);
    return {
      domain: d,
      score: p?.score ?? 0,
      subskills: subskillsOf(p?.subskills ?? {}),
      confidence: (p?.confidence ?? "low") as Confidence,
      evidenceCount: p?.evidenceCount ?? 0,
      summary: p?.summary ?? "",
      observations: stringsOf(p?.observations ?? []),
      recommendedNext: p?.recommendedNext ?? "",
      eventsLast7Days: events.filter((e) => e.domain === d && e.createdAt.getTime() >= weekAgo).length,
    };
  });
  const out = await learningAI.leader({ learnerRef: userId, domains, totalEvents: events.length, context });
  const data = {
    summary: out.summary,
    interests: out.interests,
    preferences: { ...out.preferences, recommendedDomain: out.recommendedDomain },
    observations: out.observations,
    recommendation: out.recommendation,
  };
  return prisma.leaderProfile.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}

/** learning_event 追加後にまとめて呼ぶ */
export async function recomputeAll(userId: string, touched?: DomainKey) {
  const events = await loadEvents(userId);
  const targets = touched ? [touched] : DOMAINS;
  for (const d of targets) await recomputeDomainProfile(userId, d, events);
  await recomputeLeaderProfile(userId);
}

export async function nextDifficultyFor(userId: string, domain: DomainKey): Promise<number> {
  const events = await loadEvents(userId);
  return recommendDifficulty(domain, events);
}

// ---- Dashboard 用の読み出し ----

export type DashboardData = {
  domains: {
    domain: DomainKey;
    score: number;
    subskills: Record<string, number>;
    confidence: Confidence;
    evidenceCount: number;
    summary: string;
    observations: string[];
    recommendedNext: string;
    updatedAt: string | null;
  }[];
  leader: {
    summary: string;
    interests: string[];
    observations: string[];
    recommendation: string;
    recommendedDomain: DomainKey | null;
    updatedAt: string | null;
  } | null;
  recentEvents: {
    id: string;
    domain: DomainKey;
    taskId: string;
    taskTitle: string;
    difficulty: number;
    success: boolean;
    hintCount: number;
    createdAt: string;
  }[];
  achievements: { key: string; unlockedAt: string }[];
  totalEvents: number;
};

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const [profiles, leader, recent, achievements, totalEvents] = await Promise.all([
    prisma.domainProfile.findMany({ where: { userId } }),
    prisma.leaderProfile.findUnique({ where: { userId } }),
    prisma.learningEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.achievement.findMany({ where: { userId }, orderBy: { unlockedAt: "desc" } }),
    prisma.learningEvent.count({ where: { userId } }),
  ]);
  const prefs = (leader?.preferences ?? {}) as Record<string, unknown>;
  const rd = typeof prefs.recommendedDomain === "string" ? prefs.recommendedDomain : null;
  return {
    domains: DOMAINS.map((d) => {
      const p = profiles.find((x) => x.domain === d);
      return {
        domain: d,
        score: p?.score ?? 0,
        subskills: subskillsOf(p?.subskills ?? {}),
        confidence: (p?.confidence ?? "low") as Confidence,
        evidenceCount: p?.evidenceCount ?? 0,
        summary: p?.summary ?? "",
        observations: stringsOf(p?.observations ?? []),
        recommendedNext: p?.recommendedNext ?? "",
        updatedAt: p?.updatedAt.toISOString() ?? null,
      };
    }),
    leader: leader
      ? {
          summary: leader.summary,
          interests: leader.interests,
          observations: stringsOf(leader.observations),
          recommendation: leader.recommendation,
          recommendedDomain: rd && (DOMAINS as readonly string[]).includes(rd) ? (rd as DomainKey) : null,
          updatedAt: leader.updatedAt.toISOString(),
        }
      : null,
    recentEvents: recent.map((e) => ({
      id: e.id,
      domain: e.domain as DomainKey,
      taskId: e.taskId,
      taskTitle: getTask(e.taskId)?.title ?? e.taskId,
      difficulty: e.difficulty,
      success: e.success,
      hintCount: e.hintCount,
      createdAt: e.createdAt.toISOString(),
    })),
    achievements: achievements.map((a) => ({ key: a.key, unlockedAt: a.unlockedAt.toISOString() })),
    totalEvents,
  };
}
