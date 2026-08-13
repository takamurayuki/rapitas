'use client';
// AgentGrowthPage

import { AlertTriangle, ChartNoAxesCombined } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useGrowthLedgerData } from './useGrowthLedgerData';
import { WeeklyMetricChart, type WeeklyMetricPoint } from './components/WeeklyMetricChart';
import type { GrowthLedgerWindow } from './types';

/** Skeleton loader shown while the initial data fetch is in-flight. */
function PageSkeleton() {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-64" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-64 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Formats an ISO date string into a short M/D label for chart x-axis ticks.
 *
 * @param iso - ISO 8601 date string.
 * @returns Short label, e.g. "3/20".
 */
function formatWeekLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Builds one chart's data points from ledger windows, oldest first.
 *
 * @param windows - Ledger windows, newest first (API order).
 * @param pick - Extracts the series values for one window.
 * @returns Chart-ready points, oldest week first.
 */
function toPoints(
  windows: GrowthLedgerWindow[],
  pick: (w: GrowthLedgerWindow) => Omit<WeeklyMetricPoint, 'weekLabel'>,
): WeeklyMetricPoint[] {
  return [...windows].reverse().map((w) => ({ weekLabel: formatWeekLabel(w.to), ...pick(w) }));
}

export default function AgentGrowthPage() {
  const t = useTranslations('agents.growth');
  const { ledger, loading, error } = useGrowthLedgerData();

  if (loading) return <PageSkeleton />;

  const windows = ledger?.windows ?? [];
  const iconBgClass = 'bg-indigo-100 dark:bg-indigo-900/30';
  const iconColorClass = 'text-indigo-600 dark:text-indigo-400';

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className={`p-2 rounded-lg ${iconBgClass} ${iconColorClass}`}>
              <ChartNoAxesCombined className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {t('pageTitle')}
            </h1>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400">{t('pageSubtitle')}</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {!error && windows.length === 0 && (
          <div className="text-center py-16">
            <ChartNoAxesCombined className="w-16 h-16 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-zinc-600 dark:text-zinc-400 mb-2">
              {t('emptyTitle')}
            </h2>
            <p className="text-zinc-500 dark:text-zinc-400">{t('emptyHint')}</p>
          </div>
        )}

        {windows.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <WeeklyMetricChart
              title={t('autonomy.title')}
              icon={ChartNoAxesCombined}
              iconBgClass={iconBgClass}
              iconColorClass={iconColorClass}
              valueFormat="percent"
              emptyMessage={t('emptyChart')}
              noDataLabel={t('noData')}
              series={[{ dataKey: 'autonomy', label: t('autonomy.seriesLabel'), color: '#6366f1' }]}
              data={toPoints(windows, (w) => ({ autonomy: w.autonomy.rate }))}
            />

            <WeeklyMetricChart
              title={t('criticFirstPass.title')}
              icon={ChartNoAxesCombined}
              iconBgClass={iconBgClass}
              iconColorClass={iconColorClass}
              valueFormat="percent"
              emptyMessage={t('emptyChart')}
              noDataLabel={t('noData')}
              series={[
                {
                  dataKey: 'research',
                  label: t('criticFirstPass.researchLabel'),
                  color: '#10b981',
                },
                { dataKey: 'plan', label: t('criticFirstPass.planLabel'), color: '#8b5cf6' },
              ]}
              data={toPoints(windows, (w) => ({
                research: w.criticFirstPass.research.rate,
                plan: w.criticFirstPass.plan.rate,
              }))}
            />

            <WeeklyMetricChart
              title={t('repairEfficiency.title')}
              icon={ChartNoAxesCombined}
              iconBgClass={iconBgClass}
              iconColorClass={iconColorClass}
              valueFormat="count"
              emptyMessage={t('emptyChart')}
              noDataLabel={t('noData')}
              series={[
                {
                  dataKey: 'avgPerTask',
                  label: t('repairEfficiency.seriesLabel'),
                  color: '#f59e0b',
                },
              ]}
              data={toPoints(windows, (w) => ({ avgPerTask: w.repairEfficiency.avgPerTask }))}
            />

            <WeeklyMetricChart
              title={t('defectRecurrence.title')}
              icon={ChartNoAxesCombined}
              iconBgClass={iconBgClass}
              iconColorClass={iconColorClass}
              valueFormat="percent"
              emptyMessage={t('emptyChart')}
              noDataLabel={t('noData')}
              series={[
                {
                  dataKey: 'recurrence',
                  label: t('defectRecurrence.seriesLabel'),
                  color: '#ef4444',
                },
              ]}
              data={toPoints(windows, (w) => ({ recurrence: w.defectRecurrence.rate }))}
            />

            <WeeklyMetricChart
              title={t('kbQuality.title')}
              icon={ChartNoAxesCombined}
              iconBgClass={iconBgClass}
              iconColorClass={iconColorClass}
              valueFormat="percent"
              emptyMessage={t('emptyChart')}
              noDataLabel={t('noData')}
              series={[
                { dataKey: 'validated', label: t('kbQuality.seriesLabel'), color: '#0ea5e9' },
              ]}
              data={toPoints(windows, (w) => ({ validated: w.kbQuality.rate }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
