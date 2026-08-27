import { confidenceFor } from "@/lib/scoring";
import type { Confidence, DomainKey } from "@/lib/domain";

// domain 色は CSS 変数経由で参照する。
// DOMAIN_META.color は固定 hex なので、ダークモードで明度を上げられない。
// globals.css 側で --read / --write / --code を再定義できるようにするためのマップ。
export const DOMAIN_VAR: Record<DomainKey, string> = {
  READ: "var(--read)",
  WRITE: "var(--write)",
  CODE: "var(--code)",
};

export const CONFIDENCE_TEXT: Record<Confidence, string> = {
  low: "分析中",
  medium: "おおよそ確か",
  high: "十分な記録",
};

/**
 * 次の信頼度に上がるまでの残り問題数。
 * しきい値を二重管理しないよう、scoring.ts の confidenceFor を実際に叩いて求める。
 * すでに最高なら null。
 */
export function eventsToNextConfidence(evidenceCount: number): number | null {
  const current = confidenceFor(evidenceCount);
  for (let n = evidenceCount + 1; n <= evidenceCount + 100; n++) {
    if (confidenceFor(n) !== current) return n - evidenceCount;
  }
  return null;
}

/**
 * 描画基準時刻。Server Component から await して取得する。
 * （コンポーネント本体で直接 Date.now() を呼ぶと React の純粋性ルールに反する）
 */
export async function renderNow(): Promise<number> {
  return Date.now();
}

/**
 * 相対時刻。**サーバ側でのみ**呼ぶこと（クライアントで再計算すると hydration がずれる）。
 */
export function relativeTime(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}日前`;
  const week = Math.floor(day / 7);
  if (day < 30) return `${week}週間前`;
  return `${Math.floor(day / 30)}か月前`;
}

/** 学習イベント1件を日本語の一文にする（履歴の読みやすさ用） */
export function eventOutcomeText(success: boolean, hintCount: number): string {
  if (success) return hintCount === 0 ? "ヒントなしで正解" : `ヒント${hintCount}回で正解`;
  return hintCount > 0 ? `未達（ヒント${hintCount}回）` : "未達";
}
