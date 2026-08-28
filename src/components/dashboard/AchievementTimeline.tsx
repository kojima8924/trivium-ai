import { TIER_LABEL } from "@/lib/achievement-defs";
import type { AchievementTier } from "@/lib/achievement-defs";
import type { TimelineItem } from "@/lib/history.pure";

// 実績の解除履歴（新しい順）。「いつ・何を」だけを短く出す。
// 一覧（未解除も含めた全体）は AchievementList 側の役割なので、ここでは重ねない。
const TIER_DOT: Record<AchievementTier, string> = {
  bronze: "bg-amber-700/60",
  silver: "bg-slate-400/70",
  gold: "bg-yellow-400/80",
};

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(new Date(iso));
}

export function AchievementTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted">まだ実績はありません。1 問解くと「最初の一歩」が解除されます。</p>;
  }
  return (
    <ol className="space-y-1.5">
      {items.map((a) => (
        <li key={a.key} className="flex items-start gap-2 text-xs">
          <span className="w-9 shrink-0 pt-0.5 text-right tabular-nums text-muted">{formatDay(a.unlockedAt)}</span>
          <span aria-hidden="true" className={`mt-1.5 size-1.5 shrink-0 rounded-full ${TIER_DOT[a.tier]}`} />
          <span aria-hidden="true" className="text-base leading-none">
            {a.emoji}
          </span>
          <span className="min-w-0">
            <span className="font-semibold">{a.title}</span>
            <span className="ml-1 text-[10px] text-muted">{TIER_LABEL[a.tier]}</span>
            {a.description && <span className="block leading-snug text-muted">{a.description}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
