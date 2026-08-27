import type { DashboardData } from "@/lib/profile";
import { DOMAIN_VAR, eventOutcomeText, relativeTime } from "./shared";

/**
 * 最近の学習履歴。
 * 相対時刻は Server Component で確定させる（クライアント側で計算すると hydration がずれる）。
 */
export function HistoryList({ events, now }: { events: DashboardData["recentEvents"]; now: number }) {
  if (events.length === 0) {
    return <p className="text-xs text-muted">まだありません。1問取り組むとここに残ります。</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-2.5 py-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
            style={
              e.success
                ? { background: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }
                : { background: "color-mix(in srgb, var(--ng) 14%, transparent)", color: "var(--ng)" }
            }
          >
            {e.success ? "✓" : "—"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="wordmark shrink-0 text-[10px]" style={{ color: DOMAIN_VAR[e.domain] }}>
                {e.domain}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{e.taskTitle}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              難易度 {e.difficulty} · {eventOutcomeText(e.success, e.hintCount)} · {relativeTime(e.createdAt, now)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
