// READ / WRITE / CODE の共通定義（クライアント・サーバ両方から import 可）

export const DOMAINS = ["READ", "WRITE", "CODE"] as const;
export type DomainKey = (typeof DOMAINS)[number];

export function isDomainKey(v: unknown): v is DomainKey {
  return typeof v === "string" && (DOMAINS as readonly string[]).includes(v);
}

export function parseDomain(v: string | undefined | null): DomainKey | null {
  if (!v) return null;
  const upper = v.toUpperCase();
  if (upper === "LOGIC") return "CODE"; // 表示名 LOGIC は内部キー CODE（DB の enum は変えない）
  return isDomainKey(upper) ? upper : null;
}

// 各domainの内部subskill（skills are local）
export const SUBSKILLS: Record<DomainKey, readonly string[]> = {
  READ: ["comprehension", "inference", "critical_reading"],
  WRITE: ["structure", "clarity", "reasoning", "revision"],
  CODE: ["tracing", "debugging", "algorithms", "design"],
};

export const SUBSKILL_LABELS: Record<string, string> = {
  comprehension: "要旨把握",
  inference: "推論",
  critical_reading: "批判的読解",
  structure: "構成",
  clarity: "明確さ",
  reasoning: "根拠づけ",
  revision: "推敲",
  tracing: "手順の追跡",
  debugging: "誤りの発見",
  algorithms: "手順の設計",
  design: "構造化・言語化",
};

export const DOMAIN_META: Record<
  DomainKey,
  { label: string; ja: string; tagline: string; color: string; path: string }
> = {
  // color は CSS 変数を参照する（globals.css でダークモード時に明度を上げるため）
  READ: {
    label: "READ",
    ja: "読む",
    tagline: "短文を読み、要旨・推論・批判的読解に答える",
    color: "var(--read)",
    path: "/learn/read",
  },
  WRITE: {
    label: "WRITE",
    ja: "書く",
    tagline: "主張や説明を書き、構成・根拠・反論を磨く",
    color: "var(--write)",
    path: "/learn/write",
  },
  // 内部キーは CODE のまま。表示は LOGIC（Python の読解と、論理的判断の問題の両方を含む）
  CODE: {
    label: "LOGIC",
    ja: "論理",
    tagline: "短いPythonや手順・条件の問題で、追跡・誤りの発見・手順の設計を鍛える",
    color: "var(--code)",
    path: "/learn/logic",
  },
};

export type Confidence = "low" | "medium" | "high";


export const MAX_HINTS = 3;

/** ユーザー向け文章に内部キー CODE が残っていたら表示名 LOGIC に直す（LLM 出力の安全網） */
export function toUserWording(text: string): string {
  return text.replace(/(?<![A-Za-z_])CODE(?![A-Za-z_])/g, "LOGIC");
}
