'use client';
// MetricsCharts
import { useTranslations } from 'next-intl';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type {
  ExecutionTrendData,
  AgentPerformanceComparison,
} from '../_hooks/useMetricsData';

/** Chart color palette — index wraps around for more than 10 series. */
const COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#f97316',
  '#06b6d4',
  '#84cc16',
  '#ec4899',
  '#6366f1',
];

/** Shared tooltip style for dark-mode compatibility. */
const tooltipStyle = {
  backgroundColor: 'rgb(39, 39, 42)',
  border: '1px solid rgb(63, 63, 70)',
  borderRadius: '8px',
  color: 'white',
};

interface MetricsChartsProps {
  executionTrends: ExecutionTrendData[];
  performanceComparison: AgentPerformanceComparison[];
}

/**
 * Renders area, bar, and pie charts for execution trends and agent performance.
 *
 * @param executionTrends - Daily/weekly/monthly execution counts / 実行トレンドデータ
 * @param performanceComparison - Per-agent-type performance metrics / エージェント比較データ
 */
export function MetricsCharts({
  executionTrends,
  performanceComparison,
}: MetricsChartsProps) {
  const t = useTranslations('agents');

  return (
    <>
      {/* Execution trend */}
      <div className="mb-8">
        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            {t('executionTrend')}
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={executionTrends}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#374151"
                  opacity={0.3}
                />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="successful"
                  stackId="1"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.6}
                  name={t('successful')}
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  stackId="1"
                  stroke="#ef4444"
                  fill="#ef4444"
                  fillOpacity={0.6}
                  name={t('failed')}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Performance comparison + token distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            {t('performanceComparison')}
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={performanceComparison}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#374151"
                  opacity={0.3}
                />
                <XAxis
                  dataKey="agentType"
                  stroke="#6b7280"
                  fontSize={12}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar
                  dataKey="executionCount"
                  fill="#3b82f6"
                  name={t('executionCount')}
                />
                <Bar
                  dataKey="successRate"
                  fill="#10b981"
                  name={t('successRatePercent')}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            {t('tokenDistribution')}
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={performanceComparison.map((item, index) => ({
                    name: `${item.agentType} (${item.modelId})`,
                    value: item.totalTokens,
                    fill: COLORS[index % COLORS.length],
                  }))}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name}: ${percent ? (percent * 100).toFixed(0) : '0'}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {performanceComparison.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );
}
