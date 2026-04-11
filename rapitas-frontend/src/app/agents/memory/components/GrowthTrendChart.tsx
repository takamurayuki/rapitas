/**
 * GrowthTrendChart
 *
 * Contains the knowledge growth area chart, success-rate trend chart, and
 * knowledge distribution pie chart. The confidence bar chart is handled by
 * ConfidenceTrendChart. All charts use recharts components.
 */

'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Activity, Brain, TrendingUp, Zap } from 'lucide-react';
import { PIE_COLORS, NODE_TYPE_LABELS } from '../constants';
import type { GrowthTimeline, MemoryOverview } from '../types';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-zinc-800, #27272a)',
  border: '1px solid var(--color-zinc-700, #3f3f46)',
  borderRadius: '8px',
  color: '#f4f4f5',
  fontSize: '13px',
};

interface EmptyChartProps {
  message: string;
}

/**
 * Placeholder shown when a chart has no data to display.
 *
 * @param message - Japanese message to render below the brain icon.
 */
function EmptyChart({ message }: EmptyChartProps) {
  return (
    <div className="h-60 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
      <Brain className="w-12 h-12 mb-3 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

interface GrowthTrendChartProps {
  growthTimeline: GrowthTimeline | null;
  memoryOverview: MemoryOverview | null;
  selectedPeriod: '7d' | '30d' | 'all';
  onPeriodChange: (p: '7d' | '30d' | 'all') => void;
  formatChartDate: (dateString: string) => string;
}

/**
 * Renders the growth area chart, success rate chart, and knowledge distribution
 * pie chart. Period selector is included for the main growth trend panel.
 *
 * @param growthTimeline - Timeline data for area charts.
 * @param memoryOverview - Overview data used for the pie chart.
 * @param selectedPeriod - Currently active period tab.
 * @param onPeriodChange - Called when user switches the period.
 * @param formatChartDate - Converts ISO date string to short M/D label.
 */
export function GrowthTrendChart({
  growthTimeline,
  memoryOverview,
  selectedPeriod,
  onPeriodChange,
  formatChartDate,
}: GrowthTrendChartProps) {
  return (
    <>
      {/* Knowledge growth area chart */}
      <div className="mb-8 p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg">
              <Activity className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
              知識の成長トレンド
            </h3>
          </div>
          <div className="flex gap-2">
            {(['7d', '30d', 'all'] as const).map((p) => (
              <button
                key={p}
                onClick={() => onPeriodChange(p)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  selectedPeriod === p
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                }`}
              >
                {p === '7d' ? '7日間' : p === '30d' ? '30日間' : '全期間'}
              </button>
            ))}
          </div>
        </div>

        {growthTimeline && growthTimeline.timeline.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={growthTimeline.timeline}>
              <defs>
                <linearGradient id="gradNodes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradPatterns" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient
                  id="gradExperiments"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
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
              <YAxis tick={{ fontSize: 11 }} className="fill-zinc-500" />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(v) => `${v}`}
                formatter={
                  ((value: unknown, name: unknown) => {
                    const labels: Record<string, string> = {
                      knowledgeNodes: 'ナレッジノード',
                      learningPatterns: '学習パターン',
                      experimentsCompleted: '完了実験',
                    };
                    return [value, labels[name as string] ?? name];
                  }) as never
                }
              />
              <Legend
                formatter={(value) => {
                  const labels: Record<string, string> = {
                    knowledgeNodes: 'ナレッジノード',
                    learningPatterns: '学習パターン',
                    experimentsCompleted: '完了実験',
                  };
                  return labels[value] ?? value;
                }}
              />
              <Area
                type="monotone"
                dataKey="knowledgeNodes"
                stroke="#3b82f6"
                fill="url(#gradNodes)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="learningPatterns"
                stroke="#10b981"
                fill="url(#gradPatterns)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="experimentsCompleted"
                stroke="#8b5cf6"
                fill="url(#gradExperiments)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message="成長データがまだありません" />
        )}
      </div>

      {/* Success rate + knowledge distribution (two-column) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Success rate trend */}
        <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
              成功率の推移
            </h3>
          </div>

          {growthTimeline && growthTimeline.timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={growthTimeline.timeline}>
                <defs>
                  <linearGradient id="gradSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
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
                      '成功率',
                    ]) as never
                  }
                />
                <Area
                  type="monotone"
                  dataKey="successRate"
                  stroke="#8b5cf6"
                  fill="url(#gradSuccess)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="成功率データがまだありません" />
          )}
        </div>

        {/* Knowledge distribution pie */}
        <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
              知識分布
            </h3>
          </div>

          {memoryOverview && memoryOverview.knowledgeDistribution.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={240}>
                <PieChart>
                  <Pie
                    data={memoryOverview.knowledgeDistribution.map((d) => ({
                      name: NODE_TYPE_LABELS[d.category] ?? d.category,
                      value: d.count,
                    }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {memoryOverview.knowledgeDistribution.map((_, i) => (
                      <Cell
                        key={`cell-${i}`}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {memoryOverview.knowledgeDistribution.map((item, i) => (
                  <div key={item.category} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{
                        backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                      }}
                    />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                      {NODE_TYPE_LABELS[item.category] ?? item.category}
                    </span>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyChart message="まだ知識が蓄積されていません" />
          )}
        </div>
      </div>
    </>
  );
}
