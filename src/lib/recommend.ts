// 旧「今日の 1 冊」の選択（決定論）。LLM に書名を作らせない。
// 候補は src/config/trivium.config.ts の RECOMMENDATIONS。弱い系統のものを「その日は同じ 1 件」になるよう日付で回す。
// 現在の教材推薦（LINE・Dashboard・日次総評）は src/lib/materials/ の教材カタログと推薦エンジンが担う。ここは互換とテストのために残している。
import { RECOMMENDATIONS, type AxisKey, type Recommendation } from "@/config/trivium.config";
import type { DomainKey } from "./domain";

export const AXIS_OF_DOMAIN: Record<DomainKey, AxisKey> = { READ: "read", WRITE: "write", CODE: "logic" };

/** 文字列を小さな非負整数へ（日付キー等の決定論的な回転用） */
export function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * 弱い系統の候補から 1 件を選ぶ。
 * - seen（提示済みの title）にあるものは避ける。全部提示済みなら seen を無視して回す
 * - dayKey（YYYY-MM-DD）を渡すと、同じ日は同じ 1 件になる（LINE と Web で食い違わない）
 * - その系統の候補が無ければ null
 */
export function pickRecommendation(axis: AxisKey, seen: string[] = [], dayKey = ""): Recommendation | null {
  const pool = RECOMMENDATIONS.filter((r) => r.axis === axis);
  if (pool.length === 0) return null;
  const unseen = pool.filter((r) => !seen.includes(r.title));
  const candidates = unseen.length > 0 ? unseen : pool;
  const idx = hashKey(`${axis}|${dayKey}`) % candidates.length;
  return candidates[idx];
}

/** スコア（0..100）から最も弱い系統を決める。未計測（evidence 0）は「最も弱い」扱いにする */
export function weakestAxis(domains: { domain: DomainKey; score: number; evidenceCount: number }[]): AxisKey {
  if (domains.length === 0) return "read";
  const sorted = [...domains].sort((a, b) => {
    const ea = a.evidenceCount === 0 ? -1 : a.score;
    const eb = b.evidenceCount === 0 ? -1 : b.score;
    return ea - eb;
  });
  return AXIS_OF_DOMAIN[sorted[0].domain];
}

/** LINE や Web で表示する 1 行（書名・著者・一言・有料表記） */
export function recommendationLine(r: Recommendation): string {
  const paid = r.paid ? "（有料）" : "";
  return `${r.title}${paid} / ${r.author} — ${r.note}`;
}
