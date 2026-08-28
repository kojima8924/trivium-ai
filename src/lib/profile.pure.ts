// profile まわりの純粋関数（DB に触らない部分）。server-only を付けないのでテストから直接呼べる。
// 保存値（DomainProfile）の JSON を型安全に読む helper と、events から表示用の数値を出す集計を置く。
import type { Prisma } from "@/generated/prisma/client";
import type { DomainKey } from "./domain";
import { allDomainScores, type DomainScore, type ScorableEvent } from "./scoring";

/** Json（subskills）→ 数値だけの Record */
export function subskillsOf(json: Prisma.JsonValue): Record<string, number> {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(json)) if (typeof v === "number") out[k] = v;
  return out;
}

/** Json（observations など）→ 文字列だけの配列 */
export function stringsOf(json: Prisma.JsonValue): string[] {
  return Array.isArray(json) ? json.filter((x): x is string => typeof x === "string") : [];
}

/**
 * 表示用の数値（score / level / progress / evidenceCount / confidence / subskills）を events から同じ時刻で計算する。
 * DomainProfile の保存値は最後の決着時点のもので、時間経過（新しさ重み）や複合課題の帰属で live 値とずれるため、
 * Dashboard・LINE のプロフィールカード・API はこちらを使う（保存値は AI 寸評の入力とスナップショット用）。
 */
export function liveDomainStats(events: ScorableEvent[], now: Date = new Date()): Record<DomainKey, DomainScore> {
  return allDomainScores(events, now);
}
