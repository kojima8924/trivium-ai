import { DOMAINS, DOMAIN_META } from "@/lib/domain";
import type { XpSummary } from "@/lib/xp";
import { DOMAIN_VAR } from "./shared";

/**
 * XP カード（ゲーミフィケーション）。能力の三角形＝証拠 に対して、こちらは行動の積み上げ。
 * すべて決定論の集計値（src/lib/xp.ts）。文章は入れない。
 */
export function XpCard({ xp }: { xp: XpSummary }) {
  const next = xp.rank.next;
  const toNext = next === null ? null : Math.max(0, next - xp.total);
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="xp-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="xp-heading" className="wordmark text-sm">
          XP
        </h2>
        <span className="text-[11px] text-muted">行動の積み上げ（能力図とは別の指標）</span>
      </div>

      {/* ランクと総合 XP */}
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-bold">{xp.rank.title}</div>
          <div className="text-[11px] text-muted">
            {toNext === null ? "最高ランク" : `次のランクまで あと ${toNext} XP`}
          </div>
        </div>
        <div className="shrink-0 text-2xl font-bold tabular-nums">
          {xp.total}
          <span className="ml-1 text-xs font-normal text-muted">XP</span>
        </div>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded bg-line"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(xp.rank.progress * 100)}
        aria-label="次のランクまでの進捗"
      >
        <div className="h-full rounded bg-fg" style={{ width: `${Math.max(1, Math.round(xp.rank.progress * 100))}%` }} />
      </div>

      {/* 系統別 XP */}
      <ul className="mt-3 grid grid-cols-3 gap-2 text-center">
        {DOMAINS.map((d) => (
          <li key={d} className="rounded-lg border border-line p-2">
            <div className="wordmark text-[10px]" style={{ color: DOMAIN_VAR[d] }}>
              {DOMAIN_META[d].label}
            </div>
            <div className="text-lg font-bold tabular-nums">{xp.byDomain[d]}</div>
            <div className="text-[10px] text-muted">XP</div>
          </li>
        ))}
      </ul>

      {/* 今日のミッションと streak */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-muted">今日のミッション</span>
          <ul className="flex gap-2" aria-label="今日の各系統の取り組み">
            {DOMAINS.map((d) => (
              <li
                key={d}
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${xp.today[d] ? "text-ok" : "text-muted"}`}
                style={xp.today[d] ? { background: "color-mix(in srgb, var(--ok) 14%, transparent)" } : undefined}
              >
                {DOMAIN_META[d].label} {xp.today[d] ? "✓" : "–"}
              </li>
            ))}
          </ul>
        </div>
        <div className="text-[11px]">
          {xp.missionToday ? <span className="font-semibold text-ok">達成</span> : <span className="text-muted">3 系統で 1 問ずつ</span>}
          <span className="ml-2 text-muted">🔥 {xp.streak} 日連続</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        内訳: 課題 {xp.breakdown.tasks} / ミッション {xp.breakdown.missions} / 連続 {xp.breakdown.streak}
      </p>
    </section>
  );
}
