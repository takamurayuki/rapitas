'use client';

import { useState, useEffect } from 'react';
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
import {
  Activity,
  Zap,
  Users,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Filter,
  Download,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { requireAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';

const logger = createLogger('AgentMetricsPage');

interface AgentMetrics {
  agentId: number;
  agentName: string;
  agentType: string;
  modelId: string | null;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  averageExecutionTimeMs: number | null;
  totalTokensUsed: number;
  averageTokensPerExecution: number | null;
  lastExecutionAt: Date | null;
  isActive: boolean;
}

interface ExecutionTrendData {
  date: string;
  successful: number;
  failed: number;
  totalTokens: number;
  averageTime: number | null;
}

interface MetricsOverview {
  totalExecutions: number;
  totalSuccessful: number;
  totalFailed: number;
  overallSuccessRate: number;
  totalTokensUsed: number;
  totalAgents: number;
  activeAgents: number;
  averageExecutionTime: number | null;
}

interface AgentPerformanceComparison {
  agentType: string;
  modelId: string;
  executionCount: number;
  averageTime: number | null;
  successRate: number;
  totalTokens: number;
}

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

function AgentMetricsPage() {
  const t = useTranslations('agents');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const [overview, setOverview] = useState<MetricsOverview | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<AgentMetrics[]>([]);
  const [executionTrends, setExecutionTrends] = useState<ExecutionTrendData[]>(
    [],
  );
  const [performanceComparison, setPerformanceComparison] = useState<
    AgentPerformanceComparison[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateRange, setDateRange] = useState<{
    startDate: string;
    endDate: string;
    period: 'day' | 'week' | 'month';
  }>({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    period: 'day',
  });
  const [trendDays, setTrendDays] = useState(30);

  const fetchMetricsData = async () => {
    try {
      setLoading(true);
      setError(null);

      const queryParams = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        period: dateRange.period,
      });

      const [overviewRes, agentMetricsRes, trendsRes, performanceRes] =
        await Promise.all([
          fetch(`${API_BASE_URL}/agent-metrics/overview?${queryParams}`),
          fetch(`${API_BASE_URL}/agent-metrics?${queryParams}`),
          fetch(
            `${API_BASE_URL}/agent-metrics/trends?period=${dateRange.period}&days=${trendDays}`,
          ),
          fetch(`${API_BASE_URL}/agent-metrics/performance?${queryParams}`),
        ]);

      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setOverview(data);
      }

      if (agentMetricsRes.ok) {
        const data = await agentMetricsRes.json();
        setAgentMetrics(data.metrics || []);
      }

      if (trendsRes.ok) {
        const data = await trendsRes.json();
        setExecutionTrends(data.trends || []);
      }

      if (performanceRes.ok) {
        const data = await performanceRes.json();
        setPerformanceComparison(data.performance || []);
      }
    } catch (err) {
      logger.error('Failed to fetch metrics data:', err);
      setError(t('metricsFetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetricsData();
  }, [dateRange, trendDays]);

  const exportData = () => {
    const data = {
      overview,
      agentMetrics,
      executionTrends,
      performanceComparison,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-metrics-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {t('metricsTitle')}
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1">
              {t('metricsDescription')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exportData}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {t('dataExport')}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="mb-8 p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-4">
            <Filter className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
              {t('filterSettings')}
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {t('startDate')}
              </label>
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(e) =>
                  setDateRange((prev) => ({
                    ...prev,
                    startDate: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {t('endDate')}
              </label>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, endDate: e.target.value }))
                }
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {t('period')}
              </label>
              <select
                value={dateRange.period}
                onChange={(e) =>
                  setDateRange((prev) => ({
                    ...prev,
                    period: e.target.value as 'day' | 'week' | 'month',
                  }))
                }
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              >
                <option value="day">{t('periodDay')}</option>
                <option value="week">{t('periodWeek')}</option>
                <option value="month">{t('periodMonth')}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {t('trendDays')}
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={trendDays}
                onChange={(e) => setTrendDays(parseInt(e.target.value) || 30)}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              />
            </div>
          </div>
        </div>

        {overview && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm">
                    {t('totalExecutions')}
                  </p>
                  <p className="text-2xl font-bold">
                    {overview.totalExecutions.toLocaleString()}
                  </p>
                </div>
                <Activity className="w-8 h-8 text-blue-200" />
              </div>
            </div>

            <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm">{t('successRate')}</p>
                  <p className="text-2xl font-bold">
                    {overview.overallSuccessRate.toFixed(1)}%
                  </p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-200" />
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-sm">
                    {t('totalTokenUsage')}
                  </p>
                  <p className="text-2xl font-bold">
                    {(overview.totalTokensUsed / 1000).toFixed(0)}K
                  </p>
                </div>
                <Zap className="w-8 h-8 text-purple-200" />
              </div>
            </div>

            <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-orange-100 text-sm">{t('activeAgents')}</p>
                  <p className="text-2xl font-bold">
                    {overview.activeAgents} / {overview.totalAgents}
                  </p>
                </div>
                <Users className="w-8 h-8 text-orange-200" />
              </div>
            </div>
          </div>
        )}

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
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgb(39, 39, 42)',
                      border: '1px solid rgb(63, 63, 70)',
                      borderRadius: '8px',
                      color: 'white',
                    }}
                  />
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
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgb(39, 39, 42)',
                      border: '1px solid rgb(63, 63, 70)',
                      borderRadius: '8px',
                      color: 'white',
                    }}
                  />
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
                    {performanceComparison.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgb(39, 39, 42)',
                      border: '1px solid rgb(63, 63, 70)',
                      borderRadius: '8px',
                      color: 'white',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="p-6 border-b border-zinc-200 dark:border-zinc-700">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {t('detailMetrics')}
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-50 dark:bg-zinc-750">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    {t('agentName')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    {t('model')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    {t('executionCount')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    {t('successRate')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    {t('averageExecutionTime')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    {t('tokenUsage')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    {t('lastExecution')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-700">
                {agentMetrics.map((agent) => (
                  <tr
                    key={agent.agentId}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div
                          className={`w-3 h-3 rounded-full mr-3 ${agent.isActive ? 'bg-green-500' : 'bg-zinc-400'}`}
                        />
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {agent.agentName}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                      {agent.modelId || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900 dark:text-zinc-100">
                      {agent.totalExecutions}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          agent.successRate >= 90
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : agent.successRate >= 70
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        }`}
                      >
                        {agent.successRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900 dark:text-zinc-100">
                      {agent.averageExecutionTimeMs
                        ? `${(agent.averageExecutionTimeMs / 1000).toFixed(1)}s`
                        : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900 dark:text-zinc-100">
                      {(agent.totalTokensUsed / 1000).toFixed(1)}K
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                      {agent.lastExecutionAt
                        ? new Date(agent.lastExecutionAt).toLocaleDateString(
                            dateLocale,
                          )
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {agentMetrics.length === 0 && (
              <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
                {t('noMetricsData')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default requireAuth(AgentMetricsPage);
