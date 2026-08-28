// 教材推薦（純粋関数・決定論）。能力プロフィールと会話の文脈からカタログをスコアリングする。
// LLM は関与しない（ADVISOR は結果を言い換えるだけ）。
//
//   score = domainFit × levelFit × subskillFit × textFit × novelty (× knowledge は search.ts が後から掛ける)
//
//   domainFit   : query.domain があればその系統 1.0 / 他 0.15。無ければ「弱い系統」ほど高い（未計測・低レベル・直近の失敗）
//   levelFit    : 学習者レベル+1 が [levelMin, levelMax] に入れば 1.0。帯から離れるほど 0.75^距離 で減衰。
//                 未計測（evidence 0）の系統は levelMin ≤ 3 の入門教材を優遇
//   subskillFit : 弱い小分類を含めば 1.0、系統一致だけなら 0.6
//   textFit     : query.text の語が title / tags / summary / author に当たるほど加点（無ければ 1.0）
//   novelty     : 既に勧めた教材は 0.3
import { DOMAINS, DOMAIN_META, SUBSKILL_LABELS, type DomainKey } from "@/lib/domain";
import type { LearnerProfileForMaterials, Material, MaterialQuery, MaterialRecommendation } from "./types";

const DOMAIN_OTHER = 0.15;

/** 系統の「弱さ」0..1（高いほど優先）。未計測 > 低レベル > 直近失敗 の順に効く */
export function domainWeakness(profile: LearnerProfileForMaterials, domain: DomainKey): number {
  const level = profile.levels[domain] ?? 0;
  const evidence = profile.evidence[domain] ?? 0;
  let w = evidence === 0 ? 1.0 : 1 - Math.min(10, level) / 12; // Lv0→1.0, Lv6→0.5, Lv10→0.17
  if (profile.strugglingDomain === domain) w = Math.min(1, w + 0.2);
  return Math.max(0.1, w);
}

function levelFit(profile: LearnerProfileForMaterials, m: Material, domain: DomainKey): number {
  const evidence = profile.evidence[domain] ?? 0;
  if (evidence === 0) return m.levelMin <= 3 ? 1.0 : m.levelMin <= 5 ? 0.6 : 0.3;
  const target = Math.min(10, (profile.levels[domain] ?? 0) + 1);
  if (target >= m.levelMin && target <= m.levelMax) return 1.0;
  const dist = target < m.levelMin ? m.levelMin - target : target - m.levelMax;
  return Math.pow(0.75, dist);
}

/** 自由語のトークン化（日本語は 2 文字以上の連続、英数は単語）。「Python の入門書」→ ["python", "入門書"] */
export function tokenize(text: string | undefined): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens = new Set<string>();
  for (const m of lower.match(/[a-z0-9+#.]+/g) ?? []) if (m.length >= 2) tokens.add(m);
  // 助詞（の・を・に・が・は・で・と・へ・も・や）で区切ってから 2 文字以上の語を拾う（「の入門を」→「入門」）
  const ja = lower.replace(/[のをにがはでとへもや、。,.!！?？\s]+/g, " ");
  for (const m of ja.match(/[ぁ-んァ-ヶー一-龠々]{2,}/g) ?? []) {
    tokens.add(m);
    // 「入門書」のような複合語にも当たるよう、先頭 2 文字も入れる（3 文字以上のとき）
    if (m.length >= 3) tokens.add(m.slice(0, 2));
  }
  // 意味の薄い語は捨てる
  for (const stop of ["おすすめ", "教えて", "ほしい", "ください", "教材", "本", "サイト", "何か", "なにか", "いい", "良い", "ある"]) tokens.delete(stop);
  return [...tokens];
}

function textFit(query: MaterialQuery, m: Material): { fit: number; hits: number } {
  const tokens = tokenize(query.text);
  if (tokens.length === 0) return { fit: 1.0, hits: 0 };
  const hay = `${m.title} ${m.author ?? ""} ${m.summary} ${m.why} ${m.tags.join(" ")}`.toLowerCase();
  const hits = tokens.filter((t) => hay.includes(t)).length;
  // 当たりが無くても 0 にはしない（能力適合で選べるように）。当たるほど最大 2.6 まで加点
  return { fit: hits === 0 ? 0.6 : Math.min(2.6, 1.0 + hits * 0.8), hits };
}

/** 教材の対象系統のうち、この学習者に最も効く系統を選ぶ（query.domain があればそれ） */
function pickDomain(profile: LearnerProfileForMaterials, query: MaterialQuery, m: Material): { domain: DomainKey; domainFit: number } {
  if (query.domain) {
    return { domain: query.domain, domainFit: m.domains.includes(query.domain) ? 1.0 : DOMAIN_OTHER };
  }
  let best: { domain: DomainKey; domainFit: number } | null = null;
  for (const d of m.domains) {
    const fit = domainWeakness(profile, d);
    if (!best || fit > best.domainFit) best = { domain: d, domainFit: fit };
  }
  return best ?? { domain: m.domains[0] ?? "READ", domainFit: DOMAIN_OTHER };
}

/** 学習者向けの理由（決定論）。ADVISOR はこれを言い換えてよい */
export function buildReason(profile: LearnerProfileForMaterials, m: Material, domain: DomainKey): string {
  const label = DOMAIN_META[domain].label;
  const level = profile.levels[domain] ?? 0;
  const evidence = profile.evidence[domain] ?? 0;
  const weak = profile.weakestSubskill[domain];
  const weakLabel = weak && m.subskills.includes(weak) ? SUBSKILL_LABELS[weak] ?? weak : null;
  const band = m.levelMin === m.levelMax ? `レベル ${m.levelMin}` : `レベル ${m.levelMin}〜${m.levelMax}`;
  const parts: string[] = [];
  if (evidence === 0) parts.push(`${label} はまだ未計測なので、入門から入れる ${band} 向け`);
  else if (weakLabel) parts.push(`${label} の${weakLabel}（今 Lv${level}）を伸ばす ${band} 向け`);
  else parts.push(`${label}（今 Lv${level}）の次の段階、${band} 向け`);
  if (m.why) parts.push(m.why);
  return parts.join("。") + "。";
}

/** カタログから上位 limit 件を返す。free / kind の絞り込みつき。同点は id 順（決定論） */
export function recommendMaterials(profile: LearnerProfileForMaterials, query: MaterialQuery, catalog: Material[]): MaterialRecommendation[] {
  const limit = query.limit ?? 3;
  const seen = new Set(profile.seenMaterialIds);
  const scored: MaterialRecommendation[] = [];
  for (const m of catalog) {
    if (query.freeOnly && !m.free) continue;
    if (query.kind && m.kind !== query.kind) continue;
    if (m.domains.length === 0) continue;
    const picked = pickDomain(profile, query, m);
    const domain = picked.domain;
    const { fit: tf, hits } = textFit(query, m);
    // 本人が語で指定した題材（「Python の入門」）は、弱い系統の優先より本人の希望を立てる
    const domainFit = hits > 0 && !query.domain ? Math.max(picked.domainFit, 0.9) : picked.domainFit;
    const lf = levelFit(profile, m, domain);
    // 未計測の系統は弱い小分類が分からないので減点しない
    const weak = (profile.evidence[domain] ?? 0) === 0 ? null : profile.weakestSubskill[domain];
    const sf = weak ? (m.subskills.includes(weak) ? 1.0 : 0.6) : 1.0;
    const nov = seen.has(m.id) ? 0.3 : 1.0;
    const score = domainFit * lf * sf * tf * nov;
    scored.push({
      material: m,
      score: Math.round(score * 1000) / 1000,
      reason: buildReason(profile, m, domain),
      signals: { domainFit: r3(domainFit), levelFit: r3(lf), subskillFit: sf, textFit: r3(tf), novelty: nov },
    });
  }
  scored.sort((a, b) => b.score - a.score || a.material.id.localeCompare(b.material.id));
  return scored.slice(0, limit);
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 学習者の要約 1 行（ADVISOR に渡す文脈用。数値は集計値のみ） */
export function summarizeLearner(profile: LearnerProfileForMaterials): string {
  return DOMAINS.map((d) => {
    const ev = profile.evidence[d] ?? 0;
    const weak = profile.weakestSubskill[d];
    const weakLabel = weak ? SUBSKILL_LABELS[weak] ?? weak : null;
    return `${DOMAIN_META[d].label}: ${ev === 0 ? "未計測" : `Lv${profile.levels[d]}（${ev} 問）`}${weakLabel ? `・弱め: ${weakLabel}` : ""}`;
  }).join(" / ");
}

/** チャンク本文の `id: xxx` 行、または見出し／文書名にカタログの title が含まれていれば、その教材 id */
export function matchMaterialId(content: string, docName: string, catalog: Material[]): string | null {
  const m = content.match(/(?:^|\n)\s*(?:id|ID)\s*[:：]\s*([a-z0-9-]+)/);
  if (m && catalog.some((c) => c.id === m[1])) return m[1];
  const hay = `${docName}\n${content}`;
  for (const c of catalog) if (c.title && hay.includes(c.title)) return c.id;
  return null;
}
