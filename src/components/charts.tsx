import { useState } from "react";
import type { TrafficPoint } from "../lib/types";
import { compact } from "../lib/format";

export function AreaChart({
  data,
  color = "#4f46e5",
  valueFormat = compact,
  height = 140,
}: {
  data: TrafficPoint[];
  color?: string;
  valueFormat?: (n: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 320;
  const h = 110;
  const values = data.map((d) => d.visits);
  const max = Math.max(...values) * 1.12;
  const min = Math.min(...values) * 0.88;
  const span = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : w;

  const points = data.map((d, i) => ({
    x: i * step,
    y: h - ((d.visits - min) / span) * h,
    ...d,
  }));

  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} ${w},${h} 0,${h}`;
  const active = hover === null ? null : points[hover];

  return (
    <div style={{ height }} className="flex flex-col justify-end">
      <div className="relative">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: height - 22 }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`fill-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1="0"
              x2={w}
              y1={h * g}
              y2={h * g}
              stroke="#e2e8f0"
              strokeWidth="1"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polygon points={area} fill={`url(#fill-${color.replace("#", "")})`} />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <g key={p.label}>
              <circle
                cx={p.x}
                cy={p.y}
                r={hover === i ? 4 : 2.5}
                fill="white"
                stroke={color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={p.x - step / 2}
                y={0}
                width={step}
                height={h}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          ))}
        </svg>
        {active ? (
          <div
            className="pointer-events-none absolute -top-1 rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow"
            style={{ left: `${(active.x / w) * 100}%`, transform: "translateX(-50%)" }}
          >
            {valueFormat(active.visits)}
          </div>
        ) : null}
      </div>
      <div className="flex justify-between px-0.5 text-[10px] text-slate-400">
        {data.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

export function BarList({
  data,
  color = "#4f46e5",
  valueFormat = compact,
}: {
  data: { label: string; value: number }[];
  color?: string;
  valueFormat?: (n: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label}>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">{d.label}</span>
            <span className="font-medium text-slate-900">{valueFormat(d.value)}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${(d.value / max) * 100}%`, backgroundColor: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Sparkline({
  values,
  color = "#4f46e5",
}: {
  values: number[];
  color?: string;
}) {
  const w = 100;
  const h = 28;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const line = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-24">
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Compact circular percentage — the score ring used inside summary stat cards. */
export function ProgressRing({
  value,
  max = 100,
  size = 52,
  stroke = 6,
  color = "#4f46e5",
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;
  return (
    <div className="relative shrink-0" style={{ height: size, width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-slate-900">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

export function Stars({ rating, size = 12 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - i + 1));
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 20 20">
            <defs>
              <linearGradient id={`star-${i}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor="#f59e0b" />
                <stop offset={`${fill * 100}%`} stopColor="#e2e8f0" />
              </linearGradient>
            </defs>
            <path
              d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z"
              fill={`url(#star-${i}-${Math.round(fill * 100)})`}
            />
          </svg>
        );
      })}
    </span>
  );
}

export function DeltaPill({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const good = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
        good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      {good ? "▲" : "▼"} {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}
