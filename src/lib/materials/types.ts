// 教材（書籍・Web サイト・動画・問題集）のメタデータ。
// ADVISOR が能力プロフィール（到達レベル・弱い小分類）に合わせて推薦するための共通型。
// 純粋モジュール（server-only なし）。カタログ本体は catalog.ts、推薦ロジックは recommend.ts、検索は search.ts。
import type { DomainKey } from "@/lib/domain";

export type MaterialKind = "book" | "web" | "video" | "course" | "practice";

export type Material = {
  /** 安定 id（例: `book-ronri-training-101`）。推薦履歴の重複判定に使う */
  id: string;
  title: string;
  kind: MaterialKind;
  /** 著者・出版社・運営者など */
  author?: string;
  /** 公式 URL（Web/動画/コース/問題集）。書籍は出版社や公式ページがあれば */
  url?: string;
  /** 主に伸びる系統（複数可） */
  domains: DomainKey[];
  /** 伸びる小分類（SUBSKILLS のキー: comprehension / inference / … / tracing など） */
  subskills: string[];
  /** 対象の到達レベル帯（1〜10）。levelMin 以上 levelMax 以下の学習者に向く */
  levelMin: number;
  levelMax: number;
  /** 1〜2 文の紹介（何が学べるか） */
  summary: string;
  /** どんな人に効くか（推薦理由の素材。「〜な人向け」） */
  why: string;
  /** 無料か */
  free: boolean;
  /** 検索用タグ（自由語。例: "Python", "現代文", "論理パズル"） */
  tags: string[];
  /** 日本語以外なら言語 */
  language?: "ja" | "en";
};

/** 推薦の入力: 学習者の状態（決定論的な集計から作る） */
export type LearnerProfileForMaterials = {
  /** 系統ごとの到達レベル（0〜10。未計測は 0） */
  levels: Record<DomainKey, number>;
  /** 系統ごとの証拠量（回答数）。0 なら未計測 */
  evidence: Record<DomainKey, number>;
  /** 弱い小分類（系統ごと。無ければ null） */
  weakestSubskill: Record<DomainKey, string | null>;
  /** 直近で失敗が多い系統（あれば） */
  strugglingDomain?: DomainKey | null;
  /** 既に推薦した教材 id（直近）。重複を避ける */
  seenMaterialIds: string[];
};

/** 推薦のリクエスト（会話の文脈） */
export type MaterialQuery = {
  /** 本人が指定した系統（「LOGIC の本」など）。無ければ弱い系統を優先 */
  domain?: DomainKey | null;
  /** 自由語（「Python の入門書」「短い小説」など） */
  text?: string;
  /** 形式の希望（本だけ・無料だけ など） */
  kind?: MaterialKind | null;
  freeOnly?: boolean;
  /** 返す件数（既定 3） */
  limit?: number;
};

/** 推薦結果 1 件 */
export type MaterialRecommendation = {
  material: Material;
  /** 0〜1。系統の弱さ × レベル適合 × 小分類一致 × 語の一致 × 新規性 */
  score: number;
  /** 学習者向けの理由（決定論で組み立てる。LLM はこれを言い換えてよい） */
  reason: string;
  /** どの根拠で選んだか（デバッグ・説明用） */
  signals: { domainFit: number; levelFit: number; subskillFit: number; textFit: number; novelty: number; knowledge?: number };
};
