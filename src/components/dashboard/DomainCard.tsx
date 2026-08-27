import Link from "next/link";
import { DOMAIN_META, SUBSKILLS, SUBSKILL_LABELS } from "@/lib/domain";
import type { DashboardData } from "@/lib/profile";
import { CONFIDENCE_TEXT, DOMAIN_VAR, eventsToNextConfidence } from "./shared";

/**
 * domain ごとの寸評カード。
 * subskill は「計測済み」と「未計測」を明示し、0-100 のスケールが分かるよう目盛りを引く。
 */
export function DomainCard({ d }: { d: DashboardData["domains"][number] }) {
  const meta = DOMAIN_META[d.domain];
  const color = DOMAIN_VAR[d.domain];
  const measured = d.evidenceCount > 0;
  const remaining = eventsToNextConfidence(d.evidenceCount);
  const unmeasured = SUBSKILLS[d.domain].filter((s) => !(s in d.subskills));

  return (
    <section className="card flex flex-col gap-3 p-4" style={{ borderTopColor: color, borderTopWidth: 3 }} aria-labelledby={`domain-${d.domain}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={`domain-${d.domain}`} className="wordmark text-sm" style={{ color }}>
          {d.domain}
        </h3>
        <span className="text-[11px] text-muted">
          {measured ? `${d.evidenceCount}件 · ${CONFIDENCE_TEXT[d.confidence]}` : "未計測"}
        </span>
      </div>

      <p className="text-sm leading-relaxed">{d.summary || "まだ学習記録がありません。1問取り組むと分析が始まります。"}</p>

      {Object.keys(d.subskills).length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
            <span>観点別（0–100）</span>
            <span aria-hidden="true" className="tabular-nums">
              0 · 50 · 100
            </span>
          </div>
          <ul className="space-y-1.5 text-xs">
            {SUBSKILLS[d.domain]
              .filter((s) => s in d.subskills)
              .map((k) => {
                const v = d.subskills[k];
                return (
                  <li key={k} className="flex items-center gap-2">
                    <span className="w-[5.5rem] shrink-0 text-muted">{SUBSKILL_LABELS[k] ?? k}</span>
                    <span
                      className="relative h-2 flex-1 overflow-hidden rounded bg-line"
                      role="meter"
                      aria-valuenow={v}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${SUBSKILL_LABELS[k] ?? k} ${v}点`}
                    >
                      <span className="block h-full rounded" style={{ width: `${v}%`, background: color }} />
                      {/* 50 の目盛り */}
                      <span className="absolute inset-y-0 left-1/2 w-px bg-bg-elev opacity-70" aria-hidden="true" />
                    </span>
                    <span className="w-7 text-right tabular-nums">{v}</span>
                  </li>
                );
              })}
          </ul>
          {unmeasured.length > 0 && (
            <p className="mt-1.5 text-[11px] text-muted">
              未計測: {unmeasured.map((s) => SUBSKILL_LABELS[s] ?? s).join("・")}
            </p>
          )}
        </div>
      )}

      {d.recommendedNext && (
        <p className="rounded-lg bg-bg p-2 text-xs leading-relaxed">
          <span className="font-semibold">次:</span> {d.recommendedNext}
        </p>
      )}

      {measured && remaining !== null && (
        <p className="text-[11px] text-muted">あと{remaining}問で信頼度が上がります</p>
      )}

      <Link href={meta.path} className="btn mt-auto text-sm" aria-label={`${d.domain}（${meta.ja}）の課題へ`}>
        {meta.ja}課題へ
      </Link>
    </section>
  );
}
