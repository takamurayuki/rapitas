/**
 * DashboardKpiStrip
 *
 * Compact summary strip (today's completions, completion rate). Pure
 * presentational.
 */
'use client';
import { useTranslations } from 'next-intl';
import { CheckCircle2, TrendingUp } from 'lucide-react';
import type { OverviewStats } from './use-dashboard-data';

interface DashboardKpiStripProps {
  overview: OverviewStats | null;
}

/**
 * Render the dashboard KPI strip.
 *
 * @param props - Overview statistics from useDashboardData. / 概要統計。
 */
export function DashboardKpiStrip({ overview }: DashboardKpiStripProps) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');

  // NOTE: Icons stay zinc-muted on purpose — the numbers carry the hierarchy
  // (design language: neutral base, color only when it has a meaning).
  return (
    <div className="grid grid-cols-2 divide-x divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-zinc-400 dark:text-zinc-500" />
        <div className="min-w-0">
          <div className="text-xl font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
            {overview?.tasks.todayCompleted || 0}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {tc('today')}
            {t('taskComplete')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <TrendingUp className="h-5 w-5 shrink-0 text-zinc-400 dark:text-zinc-500" />
        <div className="min-w-0">
          <div className="text-xl font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
            {overview?.tasks.completionRate || 0}%
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {overview?.tasks.completed || 0}/{overview?.tasks.total || 0}
          </p>
        </div>
      </div>
    </div>
  );
}
