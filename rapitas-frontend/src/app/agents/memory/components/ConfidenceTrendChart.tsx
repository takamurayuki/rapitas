/**
 * ConfidenceTrendChart
 *
 * Bar chart showing the average confidence score of learning patterns
 * over time. Rendered only when timeline data with non-zero confidence exists.
 */

'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Target } from 'lucide-react';
import type { GrowthTimeline } from '../types';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-zinc-800, #27272a)',
  border: '1px solid var(--color-zinc-700, #3f3f46)',
  borderRadius: '8px',
  color: '#f4f4f5',
  fontSize: '13px',
};

interface ConfidenceTrendChartProps {
  growthTimeline: GrowthTimeline;
  formatChartDate: (dateString: string) => string;
}

/**
 * Renders a bar chart of average confidence values over the selected period.
 * Filters out entries where avgConfidence is 0 to keep the chart clean.
 *
 * @param growthTimeline - Timeline data supplying avgConfidence per entry.
 * @param formatChartDate - Formats a date string for X-axis tick labels.
 */
export function ConfidenceTrendChart({
  growthTimeline,
  formatChartDate,
}: ConfidenceTrendChartProps) {
  const data = growthTimeline.timeline.filter((d) => d.avgConfidence > 0);
  if (data.length === 0) return null;

  return (
    <div className="mb-8 p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg">
          <Target className="w-5 h-5" />
        </div>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
          信頼度の推移
        </h3>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-zinc-200 dark:stroke-zinc-700"
          />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            className="fill-zinc-500"
            tickFormatter={formatChartDate}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            className="fill-zinc-500"
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={
              ((v: unknown) => [
                `${(Number(v) * 100).toFixed(1)}%`,
                '信頼度',
              ]) as never
            }
          />
          <Bar dataKey="avgConfidence" fill="#f59e0b" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
