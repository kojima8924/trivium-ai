// 教材検索: ローカルの推薦（決定論）に、Dify ナレッジ（設定時のみ）の検索結果を重ねて再ランクする。
//
//   - ローカル: recommendMaterials(profile, query, MATERIALS)
//   - Dify: POST {DIFY_BASE_URL}/v1/datasets/{DIFY_MATERIALS_DATASET_ID}/retrieve（Authorization: Bearer DIFY_DATASET_API_KEY）
//           ヒットしたチャンクから教材 id（本文の `id: xxx` 行、または見出し＝title）を拾い、順位に応じて knowledge（0〜1）を足す
//   - Dify が未設定・失敗のときはローカルだけ（console.warn 1 行）
import "server-only";
import { env } from "@/lib/env";
import { MATERIALS } from "./catalog";
import { matchMaterialId, recommendMaterials } from "./recommend";
import type { LearnerProfileForMaterials, Material, MaterialQuery, MaterialRecommendation } from "./types";

const KNOWLEDGE_WEIGHT = 0.6; // knowledge=1 のとき score × (1 + 0.6)
const RETRIEVE_TOP_K = 5;

type RetrieveRecord = { segment?: { content?: string; document?: { name?: string } }; score?: number };

/** Dify ナレッジから教材 id → 0..1 の重みを引く。未設定なら空 */
export async function retrieveFromDify(queryText: string, catalog: Material[]): Promise<Map<string, number>> {
  const hits = new Map<string, number>();
  const { difyDatasetApiKey: key, difyMaterialsDatasetId: dataset, difyBaseUrl: base } = env.materials;
  if (!key || !dataset || !queryText.trim()) return hits;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/datasets/${encodeURIComponent(dataset)}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: queryText.slice(0, 500), retrieval_model: { search_method: "hybrid_search", top_k: RETRIEVE_TOP_K, reranking_enable: false } }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { records?: RetrieveRecord[] };
    const records = json.records ?? [];
    records.forEach((r, i) => {
      const content = r.segment?.content ?? "";
      const id = matchMaterialId(content, r.segment?.document?.name ?? "", catalog);
      if (!id) return;
      // 順位ベース（1 位 1.0 → 5 位 0.2）。API の score があれば平均する
      const rank = 1 - i / RETRIEVE_TOP_K;
      const w = typeof r.score === "number" ? (rank + Math.max(0, Math.min(1, r.score))) / 2 : rank;
      hits.set(id, Math.max(hits.get(id) ?? 0, w));
    });
  } catch (err) {
    console.warn("[materials] dify retrieve skipped:", (err as Error).message);
  }
  return hits;
}

/** ローカル推薦 ＋ Dify ナレッジの再ランク。上位 query.limit（既定 3）を返す */
export async function searchMaterials(profile: LearnerProfileForMaterials, query: MaterialQuery): Promise<MaterialRecommendation[]> {
  const limit = query.limit ?? 3;
  // ナレッジのヒットを反映するため、まず広めに取る
  const local = recommendMaterials(profile, query, MATERIALS.length ? MATERIALS : []).length
    ? recommendMaterials(profile, { ...query, limit: Math.max(limit * 4, 12) }, MATERIALS)
    : [];
  if (local.length === 0) return [];
  const hits = query.text ? await retrieveFromDify(query.text, MATERIALS) : new Map<string, number>();
  const merged = local.map((r) => {
    const k = hits.get(r.material.id);
    if (k === undefined) return r;
    return { ...r, score: Math.round(r.score * (1 + KNOWLEDGE_WEIGHT * k) * 1000) / 1000, signals: { ...r.signals, knowledge: Math.round(k * 1000) / 1000 } };
  });
  merged.sort((a, b) => b.score - a.score || a.material.id.localeCompare(b.material.id));
  return merged.slice(0, limit);
}
