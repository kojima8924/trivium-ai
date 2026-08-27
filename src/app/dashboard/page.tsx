import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { getDashboardData } from "@/lib/profile";
import { CONFIDENCE_LABELS, DOMAINS, DOMAIN_META, SUBSKILL_LABELS, type DomainKey } from "@/lib/domain";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { TriviumRadar } from "@/components/RadarChart";
import { SeedButton } from "@/components/SeedButton";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?next=/dashboard");

  const data = await getDashboardData(userId);
  const scores = Object.fromEntries(data.domains.map((d) => [d.domain, d.score])) as Record<DomainKey, number>;
  const recommended = data.leader?.recommendedDomain ?? null;

  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{session?.user?.name ?? "Learner"} の学習プロフィール</h1>
          <p className="text-xs text-muted">学習記録 {data.totalEvents} 件 — 数値は記録からの集計、文章は AI の解釈です</p>
        </div>
        {env.demoSeedEnabled && <SeedButton hasData={data.totalEvents > 0} />}
      </div>

      {/* 三角形プロフィール */}
      <section className="card p-4 sm:p-5">
        {data.totalEvents === 0 ? (
          <div className="py-8 text-center text-sm text-muted">
            まだ学習記録がありません。下の READ / WRITE / CODE から1問取り組むと、能力図が描かれます。
          </div>
        ) : (
          <TriviumRadar scores={scores} />
        )}
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          {data.domains.map((d) => (
            <Link key={d.domain} href={DOMAIN_META[d.domain].path} className="rounded-lg border border-line p-2 hover:border-fg">
              <div className="wordmark text-xs" style={{ color: DOMAIN_META[d.domain].color }}>
                {d.domain}
              </div>
              <div className="text-2xl font-bold tabular-nums">{d.evidenceCount ? d.score : "–"}</div>
              <div className="text-[11px] text-muted">{d.evidenceCount ? CONFIDENCE_LABELS[d.confidence] : "未計測"}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* Leader 総合寸評 */}
      <section className="card p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="wordmark text-sm">Leader</h2>
          <span className="text-[11px] text-muted">global learner model</span>
        </div>
        {data.leader ? (
          <>
            <p className="text-sm leading-relaxed">{data.leader.summary}</p>
            {data.leader.observations.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
                {data.leader.observations.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 rounded-lg border border-line bg-bg p-3">
              <div className="text-[11px] font-semibold text-muted">次のおすすめ</div>
              <div className="mt-1 text-sm font-medium">{data.leader.recommendation}</div>
              {recommended && (
                <Link href={DOMAIN_META[recommended].path} className="btn btn-primary mt-3 h-10 min-h-0 w-full sm:w-auto">
                  {recommended} を始める
                </Link>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">まだ分析がありません。1問取り組むと、Leader が全体像を見立てます。</p>
        )}
      </section>

      {/* 各 domain 寸評 */}
      <section className="grid gap-3 sm:grid-cols-3">
        {data.domains.map((d) => (
          <div key={d.domain} className="card flex flex-col gap-2 p-4" style={{ borderTopColor: DOMAIN_META[d.domain].color, borderTopWidth: 3 }}>
            <div className="flex items-baseline justify-between">
              <span className="wordmark text-sm" style={{ color: DOMAIN_META[d.domain].color }}>
                {d.domain}
              </span>
              <span className="text-[11px] text-muted">{d.evidenceCount} 件</span>
            </div>
            <p className="text-sm leading-relaxed">{d.summary || "まだ学習記録がありません。"}</p>
            {Object.keys(d.subskills).length > 0 && (
              <ul className="space-y-1 text-xs">
                {Object.entries(d.subskills).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-muted">{SUBSKILL_LABELS[k] ?? k}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded bg-line">
                      <span className="block h-full rounded" style={{ width: `${v}%`, background: DOMAIN_META[d.domain].color }} />
                    </span>
                    <span className="w-7 text-right tabular-nums">{v}</span>
                  </li>
                ))}
              </ul>
            )}
            {d.recommendedNext && (
              <p className="text-xs text-muted">
                <span className="font-semibold">次:</span> {d.recommendedNext}
              </p>
            )}
            <Link href={DOMAIN_META[d.domain].path} className="btn mt-auto h-9 min-h-0 text-xs">
              {DOMAIN_META[d.domain].ja}課題へ
            </Link>
          </div>
        ))}
      </section>

      {/* 最近の学習履歴 + achievements */}
      <section className="grid gap-3 sm:grid-cols-[3fr_2fr]">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">最近の学習履歴</h2>
          {data.recentEvents.length === 0 ? (
            <p className="text-xs text-muted">まだありません。</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.recentEvents.map((e) => (
                <li key={e.id} className="flex items-center gap-2 py-1.5">
                  <span className="wordmark w-12 text-[10px]" style={{ color: DOMAIN_META[e.domain].color }}>
                    {e.domain}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{e.taskTitle}</span>
                  <span className="text-[11px] text-muted">D{e.difficulty}</span>
                  <span className={`text-[11px] font-semibold ${e.success ? "text-ok" : "text-ng"}`}>
                    {e.success ? "成功" : "失敗"}
                    {e.hintCount > 0 && <span className="font-normal text-muted"> /h{e.hintCount}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Achievements</h2>
          {data.achievements.length === 0 ? (
            <p className="text-xs text-muted">まだありません。</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.achievements.map((a) => (
                <li key={a.key}>
                  <div className="font-medium">{ACHIEVEMENTS[a.key]?.title ?? a.key}</div>
                  <div className="text-[11px] text-muted">{ACHIEVEMENTS[a.key]?.description}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="text-center text-[11px] text-muted">
        {DOMAINS.map((d) => DOMAIN_META[d].label).join(" · ")} — skills are local, learner is global.
      </p>
    </div>
  );
}
