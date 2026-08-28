"use client";

// 決着後のカード（○✕・解説・参考答案・スコアとレベルの変化・ADVISOR の寸評・実績・次の導線）。
import Link from "next/link";
import { DOMAIN_META, type DomainKey } from "@/lib/domain";
import { ACHIEVEMENTS, achievementTitle } from "@/lib/achievement-defs";
import { AchievementToast } from "@/components/AchievementToast";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { formatScore } from "@/lib/scoring";
import type { SettledResult } from "./use-task-player";

export function ResultCard({
  result,
  domain,
  leaderName,
  toastKeys,
  setToastKeys,
  onNext,
}: {
  result: SettledResult;
  domain: DomainKey;
  leaderName?: string;
  toastKeys: string[];
  setToastKeys: (keys: string[]) => void;
  onNext: () => void;
}) {
  const meta = DOMAIN_META[domain];
  return (
    <section className="card flex flex-col gap-3 p-4 sm:p-5">
      <div className={`flex items-center gap-3 ${result.status === "success" ? "text-ok" : "text-ng"}`}>
        <span className="text-5xl font-black leading-none" aria-hidden="true">
          {result.status === "success" ? "○" : "✕"}
        </span>
        <span className="text-sm font-semibold">{result.status === "success" ? `正解（ヒント ${result.hintCount} 回）` : "今回は未達"}</span>
      </div>
      <div className="rounded-lg bg-bg p-3 text-sm leading-relaxed">
        <div className="mb-1 text-[11px] font-semibold text-muted">解説</div>
        {result.explanation}
      </div>
      {result.sampleAnswer && (
        <div className="rounded-lg bg-bg p-3 text-sm leading-relaxed">
          <div className="mb-1 text-[11px] font-semibold text-muted">参考答案（{result.sampleAnswer.length} 字）</div>
          <p className="passage">{result.sampleAnswer}</p>
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm">
        <span className="wordmark text-xs" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="tabular-nums">
          {formatScore(result.profile.before)} → <span className="font-bold">{formatScore(result.profile.after)}</span>
          {Math.abs(result.profile.after - result.profile.before) >= 0.05 && (
            <span className={`ml-1 text-[11px] ${result.profile.after > result.profile.before ? "text-ok" : "text-ng"}`}>
              ({result.profile.after > result.profile.before ? "+" : ""}
              {(Math.round((result.profile.after - result.profile.before) * 10) / 10).toFixed(1)})
            </span>
          )}
          <span className="ml-2 text-[11px] text-muted">
            Lv.{result.profile.levelBefore} → <span className={result.profile.levelAfter > result.profile.levelBefore ? "font-bold text-ok" : ""}>Lv.{result.profile.levelAfter}</span>
            {result.profile.levelAfter > result.profile.levelBefore ? " レベルアップ" : ""}
            {" · "}信頼度: {result.profile.confidence}
          </span>
          {result.xp && result.xp.gained > 0 && (
            <span className="ml-2 text-[11px] font-semibold text-ok">+{result.xp.gained} XP</span>
          )}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted">{result.profile.summary}</p>
      {result.leader && (
        <div className="flex items-start gap-3 rounded-lg border border-line p-3 text-xs">
          <CharacterAvatar agent="LEADER" size={40} mood={result.profile.levelAfter > result.profile.levelBefore ? "cheer" : result.status === "success" ? "happy" : "normal"} />
          <div className="min-w-0 flex-1">
            <div className="wordmark mb-1 text-[10px]">Advisor{leaderName ? ` · ${leaderName}` : ""}</div>
            <p className="leading-relaxed">{result.leader.summary}</p>
            <p className="mt-1 font-medium">次のおすすめ: {result.leader.recommendation}</p>
          </div>
        </div>
      )}
      {result.newAchievements.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold">🏅 実績解除:</span>
          {result.newAchievements.map((k) => (
            <button
              key={k}
              type="button"
              className="rounded-full border border-line bg-bg px-2 py-0.5 hover:border-fg"
              onClick={() => setToastKeys([k])}
              title={ACHIEVEMENTS[k]?.description ?? ""}
            >
              {ACHIEVEMENTS[k]?.emoji ?? "🏅"} {achievementTitle(k)}
            </button>
          ))}
        </div>
      )}
      {toastKeys.length > 0 && <AchievementToast keys={toastKeys} agent={domain} onDone={() => setToastKeys([])} />}
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href="/dashboard" className="btn btn-primary">
          Dashboard で変化を見る
        </Link>
        <button type="button" className="btn" onClick={onNext}>
          次の課題へ
        </button>
      </div>
    </section>
  );
}
