'use client';
/**
 * AgentUsageBreakdownWidget
 *
 * Visualizes real recorded API usage per agent role (researcher / planner /
 * implementer / verifier / ...): daily stacked cost chart plus a per-role
 * table with cost share, tokens, cache hit rate and failures. Data comes from
 * /agent-metrics/usage-breakdown (pure DB aggregation — no LLM calls).
 */
import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { API_BASE_URL } from '@/utils/api';
import { Spinner } from '@/components/ui/spinner';
import { formatJpy, DEFAULT_USD_JPY_RATE } from './useUsdJpyRate';
import { ROLE_COLORS } from '@/app/agents/metrics/_components/utilization-colors';

interface RoleUsageEntry {
  role: string;
  executions: number;
  failedExecutions: number;
  costUsd: number;
  shareOfCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  llmCalls: number;
  cacheHitRate: number;
  averageExecutionTimeMs: number | null;
}

interface DailyRoleCostPoint {
  date: string;
  totalCostUsd: number;
  byRole: Record<string, number>;
}

interface AgentUsageBreakdown {
  windowDays: number;
  totalCostUsd: number;
  totalExecutions: number;
  usdJpyRate?: number;
  /** Optional so a mismatched backend degrades to empty instead of crashing. */
  roles?: RoleUsageEntry[];
  dailyRoleCost?: DailyRoleCostPoint[];
}

const WINDOW_OPTIONS = [7, 14, 30] as const;

// NOTE: ROLE_COLORS moved to app/agents/metrics/_components/utilization-colors
// so the utilization charts and this widget share one role→color definition.

export default function AgentUsageBreakdownWidget() {
  const t = useTranslations('home');
  const [data, setData] = useState<AgentUsageBreakdown | null>(null);
  const [windowDays, setWindowDays] = useState<number>(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/agent-metrics/usage-breakdown?days=${windowDays}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as AgentUsageBreakdown | { error: string };
      })
      .then((v) => {
        if (cancelled) return;
        if ('error' in v) setError(v.error);
        else setData(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowDays]);

  const roleLabels: Record<string, string> = {
    researcher: t('agentUsage.roles.researcher'),
    planner: t('agentUsage.roles.planner'),
    implementer: t('agentUsage.roles.implementer'),
    verifier: t('agentUsage.roles.verifier'),
    auto_verifier: t('agentUsage.roles.auto_verifier'),
    other: t('agentUsage.roles.other'),
  };
  const labelOf = (role: string) => roleLabels[role] ?? role;
  const colorOf = (role: string) => ROLE_COLORS[role] ?? ROLE_COLORS.other;

  const rate = data?.usdJpyRate ?? DEFAULT_USD_JPY_RATE;
  const roles = data?.roles ?? [];

  // Series follow the backend's canonical role order; roles without cost still
  // appear in the table but are dropped from the stacked chart. Chart values
  // are converted to yen up-front so axis/tooltip read directly in JPY.
  const chartRoles = roles.filter((r) => r.costUsd > 0).map((r) => r.role);
  const chartData =
    data?.dailyRoleCost?.map((d) => ({
      date: d.date.slice(5).replace('-', '/'),
      ...Object.fromEntries(
        Object.entries(d.byRole).map(([k, usd]) => [k, Math.round(usd * rate)]),
      ),
    })) ?? [];

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('agentUsage.title')}
          </h3>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {t('agentUsage.windowLabel', { days: windowDays })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {data && data.totalExecutions > 0 && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('agentUsage.headerSummary', {
                executions: data.totalExecutions,
                cost: formatJpy(data.totalCostUsd, rate),
              })}
            </span>
          )}
          <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {WINDOW_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`px-2 py-0.5 text-[11px] font-medium ${
                  windowDays === d
                    ? 'bg-indigo-500 text-white'
                    : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {t('agentUsage.daysButton', { days: d })}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : error ? (
        <div className="flex h-40 items-center justify-center text-xs text-red-500">{error}</div>
      ) : !data || data.totalExecutions === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
          {t('agentUsage.noData')}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Daily cost stacked by role */}
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barCategoryGap="25%">
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v: number) => (v >= 1000 ? `¥${v / 1000}k` : `¥${v}`)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#e4e4e7',
                  }}
                  formatter={
                    ((value: number, name: string) => [
                      `¥${Math.round(value).toLocaleString('ja-JP')}`,
                      labelOf(name),
                    ]) as never
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px' }}
                  formatter={(value: string) => labelOf(value)}
                />
                {chartRoles.map((role, i) => (
                  <Bar
                    key={role}
                    dataKey={role}
                    stackId="cost"
                    fill={colorOf(role)}
                    radius={i === chartRoles.length - 1 ? [3, 3, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-role table (also the accessibility relief for the chart) */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  <th className="py-1 pr-2 font-medium">{t('agentUsage.tableRole')}</th>
                  <th className="py-1 pr-2 text-right font-medium">
                    {t('agentUsage.tableExecutions')}
                  </th>
                  <th className="py-1 pr-2 text-right font-medium">
                    {t('agentUsage.tableFailed')}
                  </th>
                  <th className="py-1 pr-2 text-right font-medium">
                    {t('agentUsage.tableOutputTokens')}
                  </th>
                  <th className="py-1 pr-2 text-right font-medium">
                    {t('agentUsage.tableCacheHit')}
                  </th>
                  <th className="py-1 text-right font-medium">{t('agentUsage.tableCost')}</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr
                    key={r.role}
                    className="border-t border-zinc-100 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
                  >
                    <td className="py-1.5 pr-2">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: colorOf(r.role) }}
                        />
                        {labelOf(r.role)}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right">{r.executions}</td>
                    <td
                      className={`py-1.5 pr-2 text-right ${
                        r.failedExecutions > 0 ? 'text-red-500 dark:text-red-400' : ''
                      }`}
                    >
                      {r.failedExecutions}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {(r.outputTokens / 1000).toFixed(0)}K
                    </td>
                    <td className="py-1.5 pr-2 text-right">{(r.cacheHitRate * 100).toFixed(1)}%</td>
                    <td className="py-1.5 text-right font-medium text-zinc-900 dark:text-zinc-100">
                      {formatJpy(r.costUsd, rate)}
                      <span className="ml-1 font-normal text-zinc-400 dark:text-zinc-500">
                        ({(r.shareOfCost * 100).toFixed(0)}%)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
