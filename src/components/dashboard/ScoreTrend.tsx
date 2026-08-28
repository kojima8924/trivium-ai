"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import type { TrendMarker, TrendPoint } from "@/lib/history.pure";

// 系統色は RadarChart と同じく CSS 変数（ダークモードで明度を上げるため）。
const DOMAIN_VAR: Record<DomainKey, string> = { READ: "var(--read)", WRITE: "var(--write)", CODE: "var(--code)" };
const KEY: Record<DomainKey, "read" | "write" | "code"> = { READ: "read", WRITE: "write", CODE: "code" };

type Props = {
  trend: TrendPoint[];
  /** 実績を解除した日（グラフ上に 🏅 を置く） */
  markers?: TrendMarker[];
};

/** 系列名は色だけに頼らない（色覚特性で青×茶の差が小さいため、線の右端にも名前を出す） */
function endLabel(x: number | string | undefined, y: number | string | undefined, value: string) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return <g />;
  return (
    <text x={px + 8} y={py} dy={4} fontSize={11} fontWeight={700} fill="var(--fg)">
      {value}
    </text>
  );
}

function renderTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-bg-elev px-2.5 py-2 text-[11px] shadow-sm">
      <div className="mb-1 font-semibold tabular-nums">{label}</div>
      <ul className="space-y-0.5">
        {DOMAINS.map((d) => {
          const p = payload.find((x) => x.dataKey === KEY[d]);
          if (!p) return null;
          return (
            <li key={d} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: DOMAIN_VAR[d] }} />
              <span className="text-muted">{DOMAIN_META[d].label}</span>
              <span className="ml-auto font-semibold tabular-nums">{Number(Array.isArray(p.value) ? p.value[0] : (p.value ?? 0)).toFixed(1)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ScoreTrend({ trend, markers = [] }: Props) {
  if (trend.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        まだ計測が足りません。2 日以上の学習記録がたまると、ここにスコアの推移が出ます。
      </p>
    );
  }

  const last = trend[trend.length - 1];
  const data = trend.map((p) => ({ ...p, isLast: p.day === last.day }));
  // 点が多い日は目盛りを間引く（ラベルの重なりを防ぐ）
  const tickInterval = Math.max(0, Math.ceil(trend.length / 7) - 1);

  return (
    <figure className="m-0">
      <div className="h-56 w-full sm:h-64" role="img" aria-label={`スコアの推移（直近 ${trend.length} 日）`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 18, right: 56, bottom: 4, left: -12 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              interval={tickInterval}
              minTickGap={8}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip content={renderTooltip} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }} />
            {DOMAINS.map((d) => (
              <Line
                key={d}
                type="monotone"
                dataKey={KEY[d]}
                name={DOMAIN_META[d].label}
                stroke={DOMAIN_VAR[d]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--bg-elev)", strokeWidth: 2 }}
                isAnimationActive={false}
                label={(props: { x?: number | string; y?: number | string; index?: number }) =>
                  props.index === data.length - 1 ? endLabel(props.x, props.y, DOMAIN_META[d].label) : <g />
                }
              />
            ))}
            {/* 実績を解除した日（複数なら件数つき） */}
            {markers.map((m) => (
              <ReferenceDot
                key={m.day}
                x={m.label}
                y={100}
                r={0}
                label={{
                  value: m.count > 1 ? `🏅×${m.count}` : "🏅",
                  position: "top",
                  fontSize: 11,
                  fill: "var(--fg)",
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {DOMAINS.map((d) => (
          <span key={d} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: DOMAIN_VAR[d] }} />
            {DOMAIN_META[d].label}
          </span>
        ))}
        <span>🏅 は実績を解除した日</span>
      </figcaption>
    </figure>
  );
}
