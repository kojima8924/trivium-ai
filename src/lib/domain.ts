// READ / WRITE / CODE の共通定義（クライアント・サーバ両方から import 可）

export const DOMAINS = ["READ", "WRITE", "CODE"] as const;
export type DomainKey = (typeof DOMAINS)[number];

export function isDomainKey(v: unknown): v is DomainKey {
  return typeof v === "string" && (DOMAINS as readonly string[]).includes(v);
}

export function parseDomain(v: string | undefined | null): DomainKey | null {
  if (!v) return null;
  const upper = v.toUpperCase();
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
  tracing: "トレース",
  debugging: "デバッグ",
  algorithms: "アルゴリズム",
  design: "設計の言語化",
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
  CODE: {
    label: "CODE",
    ja: "コード",
    tagline: "短いPythonを読み、出力予測・バグ発見・説明をする",
    color: "var(--code)",
    path: "/learn/code",
  },
};

export type Confidence = "low" | "medium" | "high";

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: "信頼度: low（分析中）",
  medium: "信頼度: medium",
  high: "信頼度: high",
};

export const MAX_HINTS = 3;
