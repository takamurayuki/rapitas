'use client';
// WeeklyMetricChart

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { LucideIcon } from 'lucide-react';
import type React from 'react';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-zinc-800, #27272a)',
  border: '1px solid var(--color-zinc-700, #3f3f46)',
  borderRadius: '8px',
  color: '#f4f4f5',
  fontSize: '13px',
};

/** One rendered line/area within a WeeklyMetricChart. */
export interface WeeklyMetricSeries {
  dataKey: string;
  label: string;
  color: string;
}

/** One point on the x-axis; values are null for weeks with no denominator. */
export interface WeeklyMetricPoint {
  weekLabel: string;
  [dataKey: string]: string | number | null;
}

interface WeeklyMetricChartProps {
  title: string;
  icon: LucideIcon;
  iconBgClass: string;
  iconColorClass: string;
  data: WeeklyMetricPoint[];
  series: WeeklyMetricSeries[];
  /**
   * `percent` renders the Y axis as 0-100% and formats values accordingly;
   * `count` renders a plain numeric axis; `minutes` renders a plain numeric
   * axis with a `分` unit suffix on ticks and tooltip values.
   */
  valueFormat: 'percent' | 'count' | 'minutes';
  /** Optional slot rendered right-aligned in the card header (e.g. diff badges). */
  headerExtra?: React.ReactNode;
  emptyMessage: string;
  noDataLabel: string;
}

/**
 * Renders one weekly time-series card for the self-growth ledger dashboard.
 * Shared across all five metrics; weeks with a null value render as a gap
 * (recharts default `connectNulls={false}`) so missing data is visually
 * distinct from a real zero.
 *
 * @param props - Chart title/icon, series definitions, data points, and value formatting mode.
 */
export function WeeklyMetricChart({
  title,
  icon: Icon,
  iconBgClass,
  iconColorClass,
  data,
  series,
  valueFormat,
  emptyMessage,
  noDataLabel,
  headerExtra,
}: WeeklyMetricChartProps) {
  const hasAnyValue = data.some((point) =>
    series.some((s) => typeof point[s.dataKey] === 'number'),
  );

  const formatValue = (value: number) => {
    if (valueFormat === 'percent') return `${(value * 100).toFixed(1)}%`;
    if (valueFormat === 'minutes') return `${value.toFixed(0)}分`;
    return value.toFixed(1);
  };
  const formatTick = (v: unknown) => {
    if (valueFormat === 'percent') return `${Math.round(Number(v) * 100)}%`;
    if (valueFormat === 'minutes') return `${v}分`;
    return `${v}`;
  };

  return (
    <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className={`p-2 rounded-lg ${iconBgClass} ${iconColorClass}`}>
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        {headerExtra && <div className="ml-auto flex items-center gap-2">{headerExtra}</div>}
      </div>

      {data.length > 0 && hasAnyValue ? (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data}>
            <defs>
              {series.map((s) => (
                <linearGradient
                  key={s.dataKey}
                  id={`grad-${s.dataKey}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
            <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} className="fill-zinc-500" />
            <YAxis
              tick={{ fontSize: 11 }}
              className="fill-zinc-500"
              domain={valueFormat === 'percent' ? [0, 1] : ['auto', 'auto']}
              tickFormatter={formatTick}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={
                ((value: unknown, name: unknown) => {
                  const s = series.find((sr) => sr.dataKey === name);
                  const label = s?.label ?? String(name);
                  if (value === null || value === undefined) return [noDataLabel, label];
                  return [formatValue(Number(value)), label];
                }) as never
              }
            />
            {series.map((s) => (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.dataKey}
                stroke={s.color}
                fill={`url(#grad-${s.dataKey})`}
                strokeWidth={2}
                connectNulls={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[220px] flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-500">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
