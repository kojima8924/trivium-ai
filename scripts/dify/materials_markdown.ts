// 教材 1 件 → Dify ナレッジ用 Markdown（export_materials.mts / upload_materials.mts で共有）
import type { Material } from "../../src/lib/materials/types";
import { DOMAIN_META, SUBSKILL_LABELS } from "../../src/lib/domain";

const KIND_LABEL: Record<Material["kind"], string> = { book: "書籍", web: "Web サイト", video: "動画", course: "オンライン講座", practice: "問題集・演習サイト" };

/** 1 教材 → Markdown（Dify のセグメント本文。検索でヒットしやすいよう、系統・小分類・タグを日本語ラベルでも書く） */
export function materialToMarkdown(m: Material): string {
  const domains = m.domains.map((d) => `${DOMAIN_META[d].label}（${DOMAIN_META[d].ja}）`).join("、");
  const subskills = m.subskills.map((s) => `${SUBSKILL_LABELS[s] ?? s}（${s}）`).join("、");
  return [
    `# ${m.title}`,
    "",
    `- id: ${m.id}`,
    `- 形式: ${KIND_LABEL[m.kind]}（${m.kind}）`,
    m.author ? `- 著者・運営: ${m.author}` : "",
    `- 系統: ${domains}`,
    `- 伸びる小分類: ${subskills}`,
    `- 対象レベル: ${m.levelMin}〜${m.levelMax}（1=誰でも、3=中学、5=高校標準、7=大学入試応用・社会人実務、9=専門家）`,
    `- 無料: ${m.free ? "はい" : "いいえ（有料）"}`,
    m.language === "en" ? "- 言語: 英語" : "- 言語: 日本語",
    m.url ? `- URL: ${m.url}` : "",
    `- タグ: ${m.tags.join("、")}`,
    "",
    "## 概要",
    m.summary,
    "",
    "## こんな人に",
    m.why,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

