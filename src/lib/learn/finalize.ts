// 決着後の集計反映。profile / ADVISOR（LeaderProfile）の再計算、実績の判定、能力の時系列スナップショット。
// before/after の差分は「直前の記録を除いた events」と「含めた events」を同じ時刻で集計して出す
// （保存値との比較だと、時間経過や前回の失敗した再計算の分が「この 1 問の変化」に混ざる）。
import "server-only";
import { prisma } from "../prisma";
import type { DomainKey } from "../domain";
import { loadEvents, recomputeAll } from "../profile";
import { evaluateAchievements } from "../achievements";
import { axesOf, computeDomainScore, DOMAIN_OF_AXIS } from "../scoring";
import { xpBreakdown } from "../xp";
import { updateLeaderMemory, updateMemoryAfterEvent } from "../memory";
import { resolveTask } from "./resolve";
import type { FinalizeResult } from "./types";

/** 変化なしの結果（練習モード・finalize 延期時）。数値は保存値ではなく events から live で出す */
export async function finalizeStub(userId: string, domain: DomainKey): Promise<FinalizeResult> {
  const [events, profile] = await Promise.all([loadEvents(userId), prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } } })]);
  const now = new Date();
  const s = computeDomainScore(domain, events, now);
  return {
    profile: {
      domain,
      before: s.score,
      after: s.score,
      levelBefore: s.level,
      levelAfter: s.level,
      confidence: s.confidence,
      summary: profile?.summary ?? "",
      recommendedNext: profile?.recommendedNext ?? "",
    },
    xp: { ...xpBreakdown(events, events, now), gained: 0, task: 0, missionBonus: 0, streakBonus: 0, missionJustDone: false },
    leader: null,
    newAchievements: [],
  };
}

export async function finalizeOrDefer(userId: string, domain: DomainKey, defer?: boolean): Promise<FinalizeResult> {
  return defer ? finalizeStub(userId, domain) : finalize(userId, domain);
}

/**
 * 系統エージェントの観察メモ → 案内役のメモ、の順で更新する。
 * 学習ループの応答を待たせないよう投げっぱなしにし、失敗しても止めない。
 */
function updateMemoriesInBackground(userId: string, domain: DomainKey): void {
  void (async () => {
    const last = await prisma.learningEvent.findFirst({ where: { userId, domain }, orderBy: { createdAt: "desc" } });
    if (!last) return;
    const task = await resolveTask(userId, last.taskId);
    await updateMemoryAfterEvent(userId, domain, {
      taskTitle: task?.title ?? last.taskId,
      domain,
      axes: { read: last.axisRead, write: last.axisWrite, code: last.axisCode },
      success: last.success,
      hintCount: last.hintCount,
      answer: last.answer,
    });
    await updateLeaderMemory(userId);
  })().catch((err) => console.warn("[memory] update failed:", (err as Error).message));
}

/**
 * 決着後の再計算。profile/ADVISOR（LeaderProfile）を更新し、achievement とスナップショットを記録する。
 */
export async function finalize(userId: string, domain: DomainKey): Promise<FinalizeResult> {
  const now = new Date();
  const eventsAfter = await loadEvents(userId);
  const eventsBefore = eventsAfter.slice(0, -1);
  const last = eventsAfter[eventsAfter.length - 1];
  const scoreBefore = computeDomainScore(domain, eventsBefore, now);
  const scoreAfter = computeDomainScore(domain, eventsAfter, now);
  const xp = xpBreakdown(eventsBefore, eventsAfter, now);
  // 決着した課題が関与した系統（複合課題なら複数）は寸評つきで再計算。他の系統も数値は更新される
  const involved = last
    ? (Object.entries(axesOf(last)) as [keyof typeof DOMAIN_OF_AXIS, number][]).filter(([, v]) => v > 0).map(([k]) => DOMAIN_OF_AXIS[k])
    : [domain];
  await recomputeAll(userId, involved.includes(domain) ? involved : [domain, ...involved]);
  const [after, leader, newAchievements] = await Promise.all([
    prisma.domainProfile.findUnique({ where: { userId_domain: { userId, domain } } }),
    prisma.leaderProfile.findUnique({ where: { userId } }),
    evaluateAchievements(userId),
  ]);
  await snapshot(userId);
  updateMemoriesInBackground(userId, domain);
  // 「今日の3問」の総評（digest）はここでは送らない。Web の API route と LINE の after() が finalize の後に順番を守って呼ぶ
  return {
    profile: {
      domain,
      before: scoreBefore.score,
      after: scoreAfter.score,
      levelBefore: scoreBefore.level,
      levelAfter: scoreAfter.level,
      confidence: scoreAfter.confidence,
      summary: after?.summary ?? "",
      recommendedNext: after?.recommendedNext ?? "",
    },
    xp,
    leader: leader ? { summary: leader.summary, recommendation: leader.recommendation } : null,
    newAchievements,
  };
}

/** 能力の時系列（3軸のスコアを 1 行保存） */
export async function snapshot(userId: string): Promise<void> {
  const events = await loadEvents(userId);
  const read = computeDomainScore("READ", events).score;
  const write = computeDomainScore("WRITE", events).score;
  const code = computeDomainScore("CODE", events).score;
  await prisma.profileSnapshot.create({ data: { userId, read, write, code } }).catch(() => undefined);
}
