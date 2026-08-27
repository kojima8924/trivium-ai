"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart as RRadar, ResponsiveContainer } from "recharts";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";

type Props = {
  scores: Record<DomainKey, number>;
  /** 比較用（変化前）。あれば薄く重ねる */
  previous?: Partial<Record<DomainKey, number>>;
};

export function TriviumRadar({ scores, previous }: Props) {
  const data = DOMAINS.map((d) => ({
    domain: d,
    score: scores[d],
    prev: previous?.[d] ?? null,
  }));
  return (
    <div className="h-64 w-full sm:h-72" role="img" aria-label={DOMAINS.map((d) => `${d} ${scores[d]}`).join(", ")}>
      <ResponsiveContainer width="100%" height="100%">
        <RRadar data={data} outerRadius="72%" margin={{ top: 16, right: 24, bottom: 16, left: 24 }}>
          <PolarGrid stroke="var(--line)" />
          <PolarAngleAxis
            dataKey="domain"
            tick={({ payload, x, y, textAnchor }) => {
              const d = payload.value as DomainKey;
              return (
                <text x={x} y={y} textAnchor={textAnchor} fill={DOMAIN_META[d].color} fontSize={13} fontWeight={700} letterSpacing="0.15em">
                  {d}
                  <tspan fill="var(--fg)" fontWeight={600} letterSpacing="0">
                    {" "}
                    {scores[d]}
                  </tspan>
                </text>
              );
            }}
          />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          {previous && (
            <Radar dataKey="prev" stroke="var(--muted)" strokeDasharray="4 4" fill="var(--muted)" fillOpacity={0.08} isAnimationActive={false} />
          )}
          <Radar dataKey="score" stroke="var(--fg)" strokeWidth={2} fill="var(--fg)" fillOpacity={0.18} isAnimationActive={false} dot={{ r: 3, fill: "var(--fg)" }} />
        </RRadar>
      </ResponsiveContainer>
    </div>
  );
}
