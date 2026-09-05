'use client';
// MetricsOverviewCards
import { Activity, Zap, Users, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MetricsOverview } from '../_hooks/useMetricsData';

interface MetricsOverviewCardsProps {
  overview: MetricsOverview;
}

/**
 * Renders the four metrics overview stats as a compact neutral KPI bar.
 *
 * NOTE: Replaced the full-height multi-hue gradient cards with the dashboard's
 * KPI-bar pattern (borders, single-hue icons) — the gradient stat-card grid is
 * a banned template per ui-design-language.md §2 tells #3/#6.
 *
 * @param overview - Aggregated metrics overview data / 集計メトリクス概要データ
 */
export function MetricsOverviewCards({ overview }: MetricsOverviewCardsProps) {
  const t = useTranslations('agents');

  return (
    <div className="mb-8 grid grid-cols-2 divide-x divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white md:grid-cols-4 md:divide-y-0 dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex items-center gap-3 px-4 py-3">
        <Activity className="h-5 w-5 shrink-0 text-indigo-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {/* NOTE: numeric thousands-separator display, not a date — out of scope for #847 */}
            {overview.totalExecutions.toLocaleString()}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {t('totalExecutions')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {overview.overallSuccessRate.toFixed(1)}%
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{t('successRate')}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Zap className="h-5 w-5 shrink-0 text-purple-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {(overview.totalTokensUsed / 1000).toFixed(0)}K
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {t('totalTokenUsage')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Users className="h-5 w-5 shrink-0 text-orange-500" />
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {overview.activeAgents} / {overview.totalAgents}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{t('activeAgents')}</p>
        </div>
      </div>
    </div>
  );
}
