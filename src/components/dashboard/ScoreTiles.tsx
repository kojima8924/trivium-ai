import Link from "next/link";
import { DOMAIN_META } from "@/lib/domain";
import type { DashboardData } from "@/lib/profile";
import { CONFIDENCE_TEXT, DOMAIN_VAR, eventsToNextConfidence } from "./shared";

/**
 * レーダー直下のスコアタイル。
 * 信頼度 low の数値は「まだ確かではない」ことが見た目で分かるようにする。
 */
export function ScoreTiles({ domains }: { domains: DashboardData["domains"] }) {
  return (
    <ul className="mt-3 grid grid-cols-3 gap-2">
      {domains.map((d) => {
        const measured = d.evidenceCount > 0;
        const remaining = eventsToNextConfidence(d.evidenceCount);
        const uncertain = d.confidence === "low";
        return (
          <li key={d.domain}>
            <Link
              href={DOMAIN_META[d.domain].path}
              className="flex h-full min-h-[88px] flex-col items-center justify-center rounded-lg border border-line p-2 text-center hover:border-fg focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ outlineColor: DOMAIN_VAR[d.domain] }}
              aria-label={
                measured
                  ? `${d.domain} スコア ${d.score}、${CONFIDENCE_TEXT[d.confidence]}、記録 ${d.evidenceCount} 件`
                  : `${d.domain} は未計測`
              }
            >
              <span className="wordmark text-[11px]" style={{ color: DOMAIN_VAR[d.domain] }}>
                {d.domain}
              </span>
              <span
                className={`text-3xl leading-tight font-bold tabular-nums ${measured && uncertain ? "text-muted" : ""}`}
              >
                {measured ? d.score : "–"}
              </span>
              <span className="text-[10px] leading-tight text-muted">
                {measured ? (
                  <>
                    {CONFIDENCE_TEXT[d.confidence]}
                    {remaining !== null && <span className="block">あと{remaining}問で更新</span>}
                  </>
                ) : (
                  "未計測"
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
