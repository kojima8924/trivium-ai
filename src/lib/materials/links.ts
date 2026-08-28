// 教材へのリンクを組み立てる（純粋関数）。
// 書籍はカタログに公式 URL を持たないことが多いので、**Amazon の検索リンク**を作る。
// 実在しない商品ページ（ASIN）を推測しないための方針。書名＋著者名で検索させる。
import type { Material } from "./types";

/** 「著者名（出版社）」から検索に効く部分だけ取り出す（括弧内の出版社は落とす） */
function authorForSearch(author?: string): string {
  if (!author) return "";
  return author.replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, " ").trim();
}

/** Amazon.co.jp の検索 URL（書名＋著者） */
export function amazonSearchUrl(m: Pick<Material, "title" | "author">): string {
  const q = [m.title, authorForSearch(m.author)].filter(Boolean).join(" ");
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}`;
}

/** honto の検索 URL（書籍の在庫・電子版を見たいとき用） */
export function hontoSearchUrl(m: Pick<Material, "title">): string {
  return `https://honto.jp/netstore/search.html?k=${encodeURIComponent(m.title)}`;
}

export type MaterialLink = { label: string; url: string };

/**
 * LINE のボタンに出すリンク。
 *   公式 URL があれば「開く」。書籍（および URL の無いもの）は Amazon 検索を必ず 1 つ付ける。
 *   返すのは最大 2 件（Flex のボタンが増えすぎないように）。
 */
export function materialLinks(m: Pick<Material, "title" | "author" | "url" | "kind">): MaterialLink[] {
  const out: MaterialLink[] = [];
  if (m.url) out.push({ label: m.kind === "book" ? "公式ページ" : "開く", url: m.url });
  if (m.kind === "book") out.push({ label: "Amazonで探す", url: amazonSearchUrl(m) });
  else if (!m.url) out.push({ label: "検索する", url: amazonSearchUrl(m) });
  return out.slice(0, 2);
}
