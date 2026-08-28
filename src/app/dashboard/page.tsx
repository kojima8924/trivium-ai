import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { getDashboardData } from "@/lib/profile";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import { TriviumRadar } from "@/components/RadarChart";
import { SeedButton } from "@/components/SeedButton";
import { ResetButton } from "@/components/ResetButton";
import { NextStep } from "@/components/dashboard/NextStep";
import { GenerateBox } from "@/components/GenerateBox";
import { ScoreTiles } from "@/components/dashboard/ScoreTiles";
import { DomainCard } from "@/components/dashboard/DomainCard";
import { HistoryList } from "@/components/dashboard/HistoryList";
import { renderNow } from "@/components/dashboard/shared";
import { AchievementList } from "@/components/dashboard/AchievementList";
import { XpCard } from "@/components/dashboard/XpCard";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { ShareProfile } from "@/components/ShareProfile";
import { dashboardMaterials } from "@/lib/materials/daily";
import { ScoreTrend } from "@/components/dashboard/ScoreTrend";
import { AchievementTimeline } from "@/components/dashboard/AchievementTimeline";
import { loadHistory } from "@/lib/history";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?next=/dashboard");

  const data = await getDashboardData(userId);
  // おすすめ教材（決定論。失敗しても Dashboard は出す）
  const materials = await dashboardMaterials(userId).catch(() => []);
  // スコアの推移と実績の解除履歴（失敗しても Dashboard は出す）
  const history = await loadHistory(userId).catch(() => ({ trend: [], achievements: [], markers: [] }));
  // 相対時刻はサーバ側で確定させる（クライアントで再計算しない＝hydration がずれない）
  const now = await renderNow();
  const scores = Object.fromEntries(data.domains.map((d) => [d.domain, d.score])) as Record<DomainKey, number>;
  const measured = Object.fromEntries(data.domains.map((d) => [d.domain, d.evidenceCount > 0])) as Record<
    DomainKey,
    boolean
  >;

  return (
    <div className="flex flex-col gap-4 py-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">{session?.user?.name ? `${session.user.name}さん` : "あなた"}の学習プロフィール</h1>
          <p className="text-xs text-muted">
            学習記録 {data.totalEvents} 件 — <span className="font-medium">数値は記録からの集計</span>、文章は AI の解釈です
          </p>
        </div>
        {env.demoSeedEnabled && (
          <div className="flex flex-wrap items-center gap-2">
            <SeedButton hasData={data.totalEvents > 0} />
            <ResetButton hasData={data.totalEvents > 0} />
          </div>
        )}
      </header>

      {/* 1. 次の一歩（主役。スクロールせずに見える位置） */}
      <NextStep
        recommendation={data.leader?.recommendation ?? null}
        recommendedDomain={data.leader?.recommendedDomain ?? null}
        totalEvents={data.totalEvents}
        materials={materials}
      />

      {/* 1.5 AI 作問（解答画面には置かない。ここで作って学習ページへ飛ぶ） */}
      <GenerateBox defaultDomain={data.leader?.recommendedDomain ?? "CODE"} />

      {/* 2. 三角形プロフィール */}
      <section className="card p-4 sm:p-5" aria-labelledby="radar-heading">
        <h2 id="radar-heading" className="sr-only">
          能力プロフィール
        </h2>
        {data.totalEvents === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            まだ学習記録がありません。1問取り組むと、ここに能力図が描かれます。
          </p>
        ) : (
          <TriviumRadar scores={scores} measured={measured} />
        )}
        <ScoreTiles domains={data.domains} />
        {/* 三角グラフを画像にして SNS に共有（ブラウザ側で描画） */}
        {data.totalEvents > 0 && (
          <ShareProfile
            name={session?.user?.name ?? "あなた"}
            domains={data.domains.map((d) => ({ domain: d.domain, level: d.level, score: d.score }))}
            xp={{ total: data.xp.total, rank: data.xp.rank.title }}
            streak={data.xp.streak}
            appUrl={env.appUrl}
          />
        )}
      </section>

      {/* 2.2 スコアの推移と実績のタイムライン（三角形は「いま」、こちらは「変化」） */}
      <section className="card p-4 sm:p-5" aria-labelledby="trend-heading">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h2 id="trend-heading" className="text-sm font-semibold">
            スコアの推移
          </h2>
          <span className="text-[11px] text-muted">直近 30 日 · 記録があった日だけ</span>
        </div>
        <ScoreTrend trend={history.trend} markers={history.markers} />
        <div className="mt-3 border-t border-line pt-3">
          <h3 className="mb-2 text-xs font-semibold">実績の解除履歴</h3>
          <AchievementTimeline items={history.achievements} />
        </div>
      </section>

      {/* 2.5 XP（行動の積み上げ。能力図とは別の指標） */}
      <XpCard xp={data.xp} />

      {/* 3. ADVISOR（LEADER）の見立て */}
      <section className="card p-4 sm:p-5" aria-labelledby="leader-heading">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="leader-heading" className="wordmark flex items-center gap-2 text-sm">
            <CharacterAvatar agent="LEADER" size={32} />
            ADVISOR
          </h2>
          <span className="text-[11px] text-muted">global learner model</span>
        </div>
        {data.leader ? (
          <>
            <p className="text-sm leading-relaxed">{data.leader.summary}</p>
            {data.leader.observations.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {data.leader.observations.map((o, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span aria-hidden="true">·</span>
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">まだ分析がありません。1問取り組むと、ADVISOR が全体像を見立てます。</p>
        )}
      </section>

      {/* 4. domain ごとの寸評 */}
      <div className="grid gap-3 sm:grid-cols-3">
        {data.domains.map((d) => (
          <DomainCard key={d.domain} d={d} />
        ))}
      </div>

      {/* 5. 履歴と achievements */}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="card p-4" aria-labelledby="history-heading">
          <h2 id="history-heading" className="mb-1 text-sm font-semibold">
            最近の学習
          </h2>
          <HistoryList events={data.recentEvents} now={now} />
        </section>
        <section className="card p-4" aria-labelledby="ach-heading">
          <h2 id="ach-heading" className="mb-2 text-sm font-semibold">
            Achievements
          </h2>
          <AchievementList achievements={data.achievements} />
        </section>
      </div>

      <p className="text-center text-[11px] text-muted">
        {DOMAINS.map((d) => DOMAIN_META[d].label).join(" · ")} — skills are local, learner is global.
      </p>
    </div>
  );
}
