import { ACHIEVEMENTS } from "@/lib/achievements";
import type { DashboardData } from "@/lib/profile";

/**
 * Achievements。未解除も薄く並べ、「何をすれば解除されるか」を見せる。
 * ACHIEVEMENTS は server-only なので Server Component からのみ使う。
 */
export function AchievementList({ achievements }: { achievements: DashboardData["achievements"] }) {
  const unlocked = new Map(achievements.map((a) => [a.key, a]));
  const keys = Object.keys(ACHIEVEMENTS);

  return (
    <>
      <ul className="space-y-2">
        {keys.map((key) => {
          const got = unlocked.has(key);
          const a = ACHIEVEMENTS[key];
          return (
            <li key={key} className={`flex items-start gap-2 ${got ? "" : "opacity-45"}`}>
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                  got ? "border-transparent bg-fg text-bg" : "border-line text-muted"
                }`}
              >
                {got ? "★" : "☆"}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {a.title}
                  {!got && <span className="ml-1 text-[10px] font-normal text-muted">未解除</span>}
                </div>
                <div className="text-[11px] leading-snug text-muted">{a.description}</div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-muted">
        {achievements.length} / {keys.length} 解除
      </p>
    </>
  );
}
