import { ACHIEVEMENTS, CATEGORY_LABEL, TIER_LABEL, type AchievementDef } from "@/lib/achievement-defs";
import type { DashboardData } from "@/lib/profile";

/**
 * Achievements。カテゴリごとに並べ、解除済みは絵文字＋ティア色で目立たせ、未解除は薄く「何をすれば解除されるか」を見せる。
 * ACHIEVEMENTS の定義は achievement-defs（server-only なし）から取る。
 */
const TIER_CLASS: Record<AchievementDef["tier"], string> = {
  bronze: "border-amber-700/40 bg-amber-700/10",
  silver: "border-slate-400/50 bg-slate-400/10",
  gold: "border-yellow-500/60 bg-yellow-400/15",
};

export function AchievementList({ achievements }: { achievements: DashboardData["achievements"] }) {
  const unlocked = new Map(achievements.map((a) => [a.key, a]));
  const keys = Object.keys(ACHIEVEMENTS);
  const categories = [...new Set(keys.map((k) => ACHIEVEMENTS[k].category))];
  const recent = [...achievements].sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt)).slice(0, 3);

  return (
    <>
      <p className="mb-2 text-[11px] text-muted">
        <span className="font-semibold text-fg">{achievements.length}</span> / {keys.length} 解除
        {recent.length > 0 && <span className="ml-2">最近: {recent.map((a) => `${ACHIEVEMENTS[a.key]?.emoji ?? "🏅"} ${ACHIEVEMENTS[a.key]?.title ?? a.key}`).join("、")}</span>}
      </p>
      <div className="space-y-3">
        {categories.map((cat) => {
          const inCat = keys.filter((k) => ACHIEVEMENTS[k].category === cat);
          const got = inCat.filter((k) => unlocked.has(k)).length;
          return (
            <section key={cat} aria-label={CATEGORY_LABEL[cat]}>
              <div className="mb-1 flex items-baseline justify-between text-[11px] text-muted">
                <span className="font-semibold">{CATEGORY_LABEL[cat]}</span>
                <span className="tabular-nums">
                  {got}/{inCat.length}
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {inCat.map((key) => {
                  const a = ACHIEVEMENTS[key];
                  const u = unlocked.get(key);
                  return (
                    <li
                      key={key}
                      className={`flex items-start gap-2 rounded-lg border p-2 ${u ? TIER_CLASS[a.tier] : "border-line opacity-45"}`}
                      title={u ? `${TIER_LABEL[a.tier]} · ${new Date(u.unlockedAt).toLocaleDateString("ja-JP")} 解除` : "未解除"}
                    >
                      <span aria-hidden="true" className={`text-xl leading-none ${u ? "" : "grayscale"}`}>
                        {a.emoji}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold leading-tight">
                          {a.title}
                          {!u && <span className="ml-1 text-[10px] font-normal text-muted">未解除</span>}
                        </div>
                        <div className="text-[11px] leading-snug text-muted">{a.description}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
