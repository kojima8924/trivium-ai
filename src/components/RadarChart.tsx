"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart as RRadar, ResponsiveContainer } from "recharts";
import { DOMAINS, type DomainKey } from "@/lib/domain";

// domain 色は CSS 変数で持つ（ダークモードで明度を上げられるようにするため）
const DOMAIN_VAR: Record<DomainKey, string> = {
  READ: "var(--read)",
  WRITE: "var(--write)",
  CODE: "var(--code)",
};

type Props = {
  scores: Record<DomainKey, number>;
  /** 記録が無い domain は「未計測」として頂点ラベルを変える */
  measured?: Partial<Record<DomainKey, boolean>>;
  /** 比較用（変化前）。あれば薄く重ねる */
  previous?: Partial<Record<DomainKey, number>>;
};

export function TriviumRadar({ scores, measured, previous }: Props) {
  const data = DOMAINS.map((d) => ({
    domain: d,
    score: scores[d],
    prev: previous?.[d] ?? null,
  }));

  const label = DOMAINS.map((d) => `${d} ${measured?.[d] === false ? "未計測" : scores[d]}`).join("、");

  return (
    <figure className="m-0">
      <div className="h-64 w-full sm:h-72" role="img" aria-label={`能力プロフィール: ${label}`}>
        <ResponsiveContainer width="100%" height="100%">
          <RRadar data={data} outerRadius="76%" margin={{ top: 24, right: 40, bottom: 16, left: 40 }}>
            {/* 25 刻みのリングでスケールを読めるようにする */}
            <PolarGrid stroke="var(--line)" gridType="polygon" />
            <PolarAngleAxis
              dataKey="domain"
              tick={({ payload, x, y, textAnchor }) => {
                const d = payload.value as DomainKey;
                const isMeasured = measured?.[d] !== false;
                return (
                  <text x={x} y={y} textAnchor={textAnchor} fontSize={13}>
                    <tspan fill={DOMAIN_VAR[d]} fontWeight={700} letterSpacing="0.15em">
                      {d}
                    </tspan>
                    <tspan fill={isMeasured ? "var(--fg)" : "var(--muted)"} fontWeight={700} fontSize={15}>
                      {" "}
                      {isMeasured ? scores[d] : "–"}
                    </tspan>
                  </text>
                );
              }}
            />
            {/* 目盛りの数値は頂点ラベルと重なって読みにくいので描かない。
                スケールは 25 刻みのリングと figcaption で示す。 */}
            <PolarRadiusAxis domain={[0, 100]} tickCount={5} axisLine={false} tick={false} />
            {previous && (
              <Radar
                dataKey="prev"
                stroke="var(--muted)"
                strokeDasharray="4 4"
                fill="var(--muted)"
                fillOpacity={0.08}
                isAnimationActive={false}
              />
            )}
            <Radar
              dataKey="score"
              stroke="var(--fg)"
              strokeWidth={2}
              fill="var(--fg)"
              fillOpacity={0.14}
              isAnimationActive={false}
              dot={({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) => {
                const d = DOMAINS[index ?? 0];
                return (
                  <circle
                    key={d}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={DOMAIN_VAR[d]}
                    stroke="var(--bg-elev)"
                    strokeWidth={1.5}
                  />
                );
              }}
            />
          </RRadar>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-center text-[11px] text-muted">
        外周が 100・リングは 25 刻み。数値は学習記録からの集計（evidence）です
      </figcaption>
    </figure>
  );
}
