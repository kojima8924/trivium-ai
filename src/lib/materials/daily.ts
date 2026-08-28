// 「今日の 1 冊」（日次総評）と Dashboard の「おすすめ教材」。どちらも決定論（同じ日は同じ結果）。
import "server-only";
import type { Recommendation } from "@/config/trivium.config";
import { AXIS_OF_DOMAIN } from "@/lib/recommend";
import type { MaterialSuggestion } from "@/components/dashboard/NextStep";
import { MATERIALS } from "./catalog";
import { buildLearnerProfile } from "./profile";
import { recommendMaterials } from "./recommend";
import type { Material, MaterialRecommendation } from "./types";

/** Material → 既存の Recommendation（ミッション達成カードの「今日の 1 冊」欄で使う） */
export function toRecommendation(r: MaterialRecommendation): Recommendation {
  const m = r.material;
  const domain = m.domains[0] ?? "READ";
  return {
    axis: AXIS_OF_DOMAIN[domain],
    title: m.title,
    author: m.author ?? (m.kind === "web" ? "Web" : ""),
    note: m.why.slice(0, 40),
    url: m.url ?? "",
    kind: m.kind === "book" ? "book" : "site",
    paid: !m.free,
  };
}

/** 日付で回す決定論的な index（同じ日は同じ 1 件） */
function dayIndex(day: string, n: number): number {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0;
  return n === 0 ? 0 : h % n;
}

/** 今日の 1 冊: 上位 3 件から日付で 1 件（無ければ null） */
export async function dailyMaterialPick(userId: string, day: string, now: Date = new Date()): Promise<Recommendation | null> {
  if (MATERIALS.length === 0) return null;
  const profile = await buildLearnerProfile(userId, [], now);
  const top = recommendMaterials(profile, { limit: 3 }, MATERIALS);
  if (top.length === 0) return null;
  return toRecommendation(top[dayIndex(day, top.length)]);
}

/** Dashboard の「おすすめ教材」（上位 3 件） */
export async function dashboardMaterials(userId: string, now: Date = new Date()): Promise<MaterialSuggestion[]> {
  if (MATERIALS.length === 0) return [];
  const profile = await buildLearnerProfile(userId, [], now);
  return recommendMaterials(profile, { limit: 3 }, MATERIALS).map((r) => toSuggestion(r.material, r.reason));
}

export function toSuggestion(m: Material, reason: string): MaterialSuggestion {
  return { id: m.id, title: m.title, kind: m.kind, author: m.author, url: m.url, free: m.free, reason };
}
