/**
 * MetricsTable
 *
 * Detailed data table listing per-agent metrics including name, model,
 * execution count, success rate, average time, token usage, and last run.
 */
'use client';
import { useTranslations } from 'next-intl';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';
import type { AgentMetrics } from './useMetricsData';

interface MetricsTableProps {
  agentMetrics: AgentMetrics[];
}

/**
 * Renders a scrollable table of detailed per-agent execution metrics.
 *
 * @param agentMetrics - Array of per-agent metric records / エージェントごとのメトリクス配列
 */
export function MetricsTable({ agentMetrics }: MetricsTableProps) {
  const t = useTranslations('agents');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  return (
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
  );
}
