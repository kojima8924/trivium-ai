// AI レイヤーのテキスト整形（純粋関数のみ。server-only を付けないのでテストから直接呼べる）。
//   - prompt へ値を載せる整形（fmt / nowText）
//   - provider 出力を各表示先（Web / LINE）に合わせて落とす整形

/** prompt に「## ラベル + 本文」で値を載せる。文字列はそのまま、それ以外は JSON 化する。 */
export function fmt(label: string, value: unknown): string {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  return `## ${label}\n${body}`;
}

/** 現在時刻（JST）。system ではなく input に入れる（system を安定させてキャッシュを効かせる） */
export function nowText(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "full", timeStyle: "short" }).format(now);
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

/**
 * OpenAI の会話返答を平文にする。太字・インラインリンク・検索由来の引用マーカーを落とす。
 * 出典 URL は別途 sources として本文末尾に添えるので、ここではリンクのテキストだけ残す。
 */
export function stripMarkdownForChat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\(\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Dify Chatflow の返答を LINE のプレーンテキストにする。
 * stripMarkdownForChat との違いは意図的: LINE は箇条書き・見出しも描画しないので「・」に潰し、
 * URL は本文に出典として残らないため リンクは「テキスト URL」の形で残す。
 */
export function plainForLine(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "・")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\(\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 $2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
