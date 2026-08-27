// AI provider 間で共有する、出力契約の純粋な正規化処理。
import type { DomainEvalOutput } from "./types";

export type EvaluationStatus = DomainEvalOutput["status"];

/** 決定論的採点を provider に渡す共通文字列へ変換する。 */
export function deterministicResultText(result: boolean | null): "correct" | "incorrect" | "unknown" {
  return result === null ? "unknown" : result ? "correct" : "incorrect";
}

/** 自由記述のヒューリスティック判定を provider に渡す共通文字列へ変換する。 */
export function heuristicResultText(result: boolean | null): "meets_rubric" | "below_rubric" | "n/a" {
  return result === null ? "n/a" : result ? "meets_rubric" : "below_rubric";
}

/** 決定論的採点が確定している場合は、AI の status を採点結果に従わせる。 */
export function safeEvaluationStatus(status: EvaluationStatus, deterministicResult: boolean | null): EvaluationStatus {
  if (deterministicResult === true) return "success";
  if (deterministicResult === false && status === "success") return "retry";
  return status;
}

/** provider が返した skill_tags を許可リスト内に限定する。 */
export function filterSkillTags(tags: readonly string[], allowedTags: readonly string[]): string[] {
  return tags.filter((tag) => allowedTags.includes(tag));
}

/** 指定段階のヒントが無い場合は最後のヒントを使う。 */
export function fallbackHint(hints: readonly string[], hintLevel: number): string {
  return hints[Math.min(hintLevel, hints.length - 1)] ?? "";
}

/** UI は Markdown を描画しないため、文字列・配列・オブジェクト内のバッククォートを再帰的に落とす。 */
export function stripBackticks<T>(value: T): T {
  if (typeof value === "string") return value.replace(/```[a-zA-Z]*\n?/g, "").replace(/`/g, "") as T;
  if (Array.isArray(value)) return value.map(stripBackticks) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = stripBackticks(item);
    return out as T;
  }
  return value;
}

/** Dify が JSON をコードフェンスで包んだ場合に外側だけを除去する。 */
export function stripJsonCodeFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
}
