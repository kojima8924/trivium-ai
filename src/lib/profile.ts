// learning_events（episodic）→ domain_profiles / leader_profiles（semantic）の再計算。
// 数値は scoring.ts で決定論的に集計し、LLM には寸評（interpretation）だけを任せる。
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { learningAI } from "./ai";
import { DOMAINS, toUserWording, type Confidence, type DomainKey } from "./domain";
import { computeDomainScore, recommendDifficulty, type DomainScore, type ScorableEvent } from "./scoring";
import { getTask } from "./tasks";
import { computeXp, type XpSummary } from "./xp";
import { personaPrompts } from "./persona";
import { carryTaskPrefs } from "./task-prefs";

const MODE: Record<DomainKey, "read" | "write" | "code"> = { READ: "read", WRITE: "write", CODE: "code" };

export type LoadedEvent = ScorableEvent & { id: string; taskId: string; generated: boolean };

export async function loadEvents(userId: string): Promise<LoadedEvent[]> {
  const rows = await prisma.learningEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      domain: true,
      taskId: true,
      difficulty: true,
      axisRead: true,
      axisWrite: true,
      axisCode: true,
      generated: true,
      success: true,
      hintCount: true,
      skillTags: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    domain: r.domain as DomainKey,
    difficulty: r.difficulty,
    axes: { read: r.axisRead, write: r.axisWrite, code: r.axisCode },
    generated: r.generated,
    success: r.success,
    hintCount: r.hintCount,
    skillTags: r.skillTags,
    createdAt: r.createdAt,
  }));
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

  const personas = await personaPrompts(userId);
  const interp = await learningAI.interpretDomain({
    mode: MODE[domain],
    learnerRef: userId,
    persona: personas[domain],
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
    summary: toUserWording(interp.summary),
    observations: interp.observations.map(toUserWording),
    recommendedNext: toUserWording(interp.recommendedNext),
  };
  return prisma.domainProfile.upsert({
    where: { userId_domain: { userId, domain } },
    update: data,
    create: { userId, domain, ...data },
  });
}

/**
 * 数値だけを保存し直す（LLM 寸評は呼ばない）。複合課題で関与した非主系統の score / evidenceCount / confidence を
 * 決着のたびに最新にするために使う（寸評は主系統だけ更新するので、非主系統の文章は前回のまま残す）。
 */
export async function refreshDomainNumbers(userId: string, domain: DomainKey, events: ScorableEvent[]) {
  const stats = computeDomainScore(domain, events);
  const data = { score: stats.score, subskills: stats.subskills, confidence: stats.confidence, evidenceCount: stats.evidenceCount };
  return prisma.domainProfile.upsert({
    where: { userId_domain: { userId, domain } },
    update: data,
    create: { userId, domain, ...data, summary: "", observations: [], recommendedNext: "" },
  });
}

/**
 * Leader profile を再計算する。
 * 数値（score / subskills / confidence）は events から決定論的に計算し直すので、
 * domain profile の保存順序に依存しない（domain 寸評の生成と並列に走らせられる）。
 * 文章（summary / observations / recommendedNext）だけは保存済みの domain profile を使う。
 */
export async function recomputeLeaderProfile(userId: string, context?: string, preloaded?: ScorableEvent[]) {
  const [profiles, events] = await Promise.all([
    prisma.domainProfile.findMany({ where: { userId } }),
    preloaded ? Promise.resolve(preloaded) : loadEvents(userId),
  ]);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const domains = DOMAINS.map((d) => {
    const p = profiles.find((x) => x.domain === d);
    const stats = computeDomainScore(d, events);
    return {
      domain: d,
      score: stats.score,
      subskills: stats.subskills,
      confidence: stats.confidence,
      evidenceCount: stats.evidenceCount,
      summary: p?.summary ?? "",
      observations: stringsOf(p?.observations ?? []),
      recommendedNext: p?.recommendedNext ?? "",
      eventsLast7Days: events.filter((e) => e.domain === d && e.createdAt.getTime() >= weekAgo).length,
    };
  });
  const last = events[events.length - 1] as (ScorableEvent & { taskId?: string }) | undefined;
  const lastEvent = last
    ? {
        domain: last.domain,
        taskTitle: getTask(last.taskId ?? "")?.title ?? last.taskId ?? "",
        difficulty: last.difficulty,
        success: last.success,
        hintCount: last.hintCount,
        minutesAgo: Math.round((Date.now() - last.createdAt.getTime()) / 60_000),
      }
    : undefined;
  const personas = await personaPrompts(userId);
  const out = await learningAI.leader({ learnerRef: userId, domains, totalEvents: events.length, lastEvent, context, persona: personas.LEADER });
  // 出題設定は LLM 呼び出し（数秒）の間に /settings で更新されることがあるので、書き戻す直前に読み直す
  const existingPrefs = await prisma.leaderProfile.findUnique({ where: { userId }, select: { preferences: true } });
  const data = {
    summary: toUserWording(out.summary),
    interests: out.interests.map(toUserWording),
    // 出題設定（excludedTaskTypes / excludeComposite）は学習者の設定なので、AI の出力で上書きせず引き継ぐ
    preferences: carryTaskPrefs(existingPrefs?.preferences, { ...out.preferences, recommendedDomain: out.recommendedDomain }) as Prisma.InputJsonValue,
    observations: out.observations.map(toUserWording),
    recommendation: toUserWording(out.recommendation),
  };
  return prisma.leaderProfile.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}

/**
 * learning_event 追加後にまとめて呼ぶ。
 * touched（決着した課題が関与した系統）は LLM 寸評つきで再計算し、それ以外の系統も数値だけは毎回更新する
 * （複合課題の失敗がボトルネック帰属で別系統に付いても、保存値が古いままにならない）。
 */
export async function recomputeAll(userId: string, touched?: DomainKey | DomainKey[]) {
  const events = await loadEvents(userId);
  const targets = touched === undefined ? [...DOMAINS] : Array.isArray(touched) ? touched : [touched];
  const rest = DOMAINS.filter((d) => !targets.includes(d));
  // domain 寸評と Leader は独立に計算できる（Leader の数値は events から直接出す）ので並列化して待ち時間を短くする
  await Promise.all([
    ...targets.map((d) => recomputeDomainProfile(userId, d, events)),
    ...rest.map((d) => refreshDomainNumbers(userId, d, events)),
    recomputeLeaderProfile(userId, undefined, events),
  ]);
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
    /** 到達レベル 0..10（決定論。scoring.ts） */
    level: number;
    /** 次のレベルへの進捗 0..1 */
    progress: number;
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
  /** XP・デイリーミッション・streak・ランク（決定論。xp.ts） */
  xp: XpSummary;
};

/**
 * 表示用の数値（score / level / progress / evidenceCount / confidence / subskills）を events から同じ時刻で計算する。
 * DomainProfile の保存値は最後の決着時点のもので、時間経過（新しさ重み）や複合課題の帰属で live 値とずれるため、
 * Dashboard・LINE のプロフィールカード・API はこちらを使う（保存値は AI 寸評の入力とスナップショット用）。
 */
export function liveDomainStats(events: ScorableEvent[], now: Date = new Date()): Record<DomainKey, DomainScore> {
  return Object.fromEntries(DOMAINS.map((d) => [d, computeDomainScore(d, events, now)])) as Record<DomainKey, DomainScore>;
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  // ローカル PG（PGlite）は並列に弱いので、読み出しは 2 段に分けて並列度を抑える
  const [profiles, leader, recent] = await Promise.all([
    prisma.domainProfile.findMany({ where: { userId } }),
    prisma.leaderProfile.findUnique({ where: { userId } }),
    prisma.learningEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const [achievements, events] = await Promise.all([
    prisma.achievement.findMany({ where: { userId }, orderBy: { unlockedAt: "desc" } }),
    loadEvents(userId),
  ]);
  const totalEvents = events.length;
  const now = new Date();
  // 数値はすべて同じ now で events から計算する（保存値と live の混在で「30.0 / Lv.0」のような矛盾を出さない）
  const live = liveDomainStats(events, now);
  const xp = computeXp(events, now);
  const prefs = (leader?.preferences ?? {}) as Record<string, unknown>;
  const rd = typeof prefs.recommendedDomain === "string" ? prefs.recommendedDomain : null;
  return {
    domains: DOMAINS.map((d) => {
      const p = profiles.find((x) => x.domain === d);
      const s = live[d];
      return {
        domain: d,
        score: s.score,
        level: s.level,
        progress: s.progress,
        subskills: s.subskills,
        confidence: s.confidence,
        evidenceCount: s.evidenceCount,
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
    xp,
  };
}
