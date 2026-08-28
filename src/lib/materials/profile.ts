// 学習者の状態 → 教材推薦の入力（LearnerProfileForMaterials）。数値は決定論の集計（liveDomainStats）だけを使う。
import "server-only";
import { prisma } from "@/lib/prisma";
import { DOMAINS, type DomainKey } from "@/lib/domain";
import { liveDomainStats, loadEvents, subskillsOf } from "@/lib/profile";
import type { LearnerProfileForMaterials } from "./types";

/** 小分類のスコア表から最も弱いものを返す（無ければ null） */
export function weakestOf(subskills: Record<string, number>): string | null {
  const entries = Object.entries(subskills);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => a[1] - b[1])[0][0];
}

/**
 * 到達レベル・証拠量（live 計算）、弱い小分類（DomainProfile.subskills）、直近 10 件で失敗が多い系統から推薦の入力を作る。
 * seenMaterialIds は呼び出し側（LINE の state など）が渡す。
 */
export async function buildLearnerProfile(userId: string, seenMaterialIds: string[] = [], now: Date = new Date()): Promise<LearnerProfileForMaterials> {
  const [events, profiles] = await Promise.all([
    loadEvents(userId),
    prisma.domainProfile.findMany({ where: { userId }, select: { domain: true, subskills: true } }),
  ]);
  const stats = liveDomainStats(events, now);
  const levels = {} as Record<DomainKey, number>;
  const evidence = {} as Record<DomainKey, number>;
  const weakestSubskill = {} as Record<DomainKey, string | null>;
  for (const d of DOMAINS) {
    levels[d] = stats[d].level;
    evidence[d] = stats[d].evidenceCount;
    const row = profiles.find((p) => p.domain === d);
    // 保存済みの小分類が無ければ live の subskills を使う
    const subs = row ? subskillsOf(row.subskills) : stats[d].subskills;
    weakestSubskill[d] = weakestOf(subs);
  }
  // 直近 10 件で失敗が 2 件以上ある系統（複数あれば失敗が多い方）
  const recent = events.slice(-10);
  const fails = new Map<DomainKey, number>();
  for (const e of recent) if (!e.success) fails.set(e.domain, (fails.get(e.domain) ?? 0) + 1);
  const struggling = [...fails.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { levels, evidence, weakestSubskill, strugglingDomain: struggling, seenMaterialIds };
}
