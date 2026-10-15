'use client';
// RetroKpiSection

import {
  AlertTriangle,
  ChartNoAxesCombined,
  FlaskConical,
  GitFork,
  GitMerge,
  IterationCw,
  Repeat,
  TimerReset,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRetroKpiData } from '../useRetroKpiData';
import { WeeklyMetricChart } from './WeeklyMetricChart';
import { KpiDiffBadge } from './KpiDiffBadge';
import { computeKpiDiff, toRetroKpiPoints } from './retro-kpi-points';

const ICON_BG = 'bg-indigo-100 dark:bg-indigo-900/30';
const ICON_COLOR = 'text-indigo-600 dark:text-indigo-400';

/** Skeleton shown while the KPI ledger fetch is in-flight (six card slots). */
function SectionSkeleton() {
  return (
    <div className="animate-pulse grid grid-cols-1 lg:grid-cols-2 gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-64 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
      ))}
    </div>
  );
}

/**
 * Renders the six supervisor-baselined self-improvement KPIs (task #774) as
 * weekly line cards with this-week vs last-week diff badges. Fetches its own
 * data so the growth-ledger cards above stay independent of this endpoint.
 */
export function RetroKpiSection() {
  const t = useTranslations('agents.growth');
  const { ledger, loading, error } = useRetroKpiData();
  const windows = ledger?.windows ?? [];
  const vsLabel = t('retroKpi.vsPrevWeek');

  const repairRateDiff = computeKpiDiff(windows, (w) => w.repairRate.rate, 'lower_is_better');
  const mergedDiff = computeKpiDiff(windows, (w) => w.autoMerged, 'higher_is_better');
  const exhaustedDiff = computeKpiDiff(windows, (w) => w.autoMergeExhausted, 'lower_is_better');
  const conflictDiff = computeKpiDiff(windows, (w) => w.autoMergeConflictFiled, 'lower_is_better');
  const noChangeDiff = computeKpiDiff(windows, (w) => w.verifyNoChangeConfirmed, 'neutral');
  const nonConvergenceDiff = computeKpiDiff(
    windows,
    (w) => w.verifyRepairNonConvergence,
    'lower_is_better',
  );
  const leadTimeDiff = computeKpiDiff(
    windows,
    (w) => w.leadTimeMinutes.medianMinutes,
    'lower_is_better',
  );

  return (
    <section className="mt-10 pt-8 border-t border-zinc-200 dark:border-zinc-700">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className={`p-2 rounded-lg ${ICON_BG} ${ICON_COLOR}`}>
            <ChartNoAxesCombined className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {t('retroKpi.sectionTitle')}
          </h2>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('retroKpi.sectionSubtitle')}</p>
      </div>

      {loading && <SectionSkeleton />}

      {!loading && error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && windows.length === 0 && (
        <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('retroKpi.emptyHint')}
        </p>
      )}

      {!loading && !error && windows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <WeeklyMetricChart
            title={t('retroKpi.repairRate.title')}
            icon={IterationCw}
            iconBgClass={ICON_BG}
            iconColorClass={ICON_COLOR}
            valueFormat="percent"
            emptyMessage={t('emptyChart')}
            noDataLabel={t('noData')}
            headerExtra={
              <KpiDiffBadge diff={repairRateDiff} label={vsLabel} valueFormat="percent" />
            }
            series={[
              { dataKey: 'rate', label: t('retroKpi.repairRate.seriesLabel'), color: '#f59e0b' },
            ]}
            data={toRetroKpiPoints(windows, (w) => ({ rate: w.repairRate.rate }))}
          />

          <WeeklyMetricChart
            title={t('retroKpi.autoMerge.title')}
            icon={GitMerge}
            iconBgClass={ICON_BG}
            iconColorClass={ICON_COLOR}
            valueFormat="count"
            emptyMessage={t('emptyChart')}
            noDataLabel={t('noData')}
            headerExtra={
              <>
                <KpiDiffBadge
                  diff={mergedDiff}
                  label={vsLabel}
                  seriesLabel={t('retroKpi.autoMerge.mergedLabel')}
                  valueFormat="count"
                />
                <KpiDiffBadge
                  diff={exhaustedDiff}
                  label={vsLabel}
                  seriesLabel={t('retroKpi.autoMerge.exhaustedLabel')}
                  valueFormat="count"
                />
              </>
            }
            series={[
              { dataKey: 'merged', label: t('retroKpi.autoMerge.mergedLabel'), color: '#10b981' },
              {
                dataKey: 'exhausted',
                label: t('retroKpi.autoMerge.exhaustedLabel'),
                color: '#ef4444',
              },
            ]}
            data={toRetroKpiPoints(windows, (w) => ({
              merged: w.autoMerged,
              exhausted: w.autoMergeExhausted,
            }))}
          />

          <WeeklyMetricChart
            title={t('retroKpi.conflictFiled.title')}
            icon={GitFork}
            iconBgClass={ICON_BG}
            iconColorClass={ICON_COLOR}
            valueFormat="count"
            emptyMessage={t('emptyChart')}
            noDataLabel={t('noData')}
            headerExtra={<KpiDiffBadge diff={conflictDiff} label={vsLabel} valueFormat="count" />}
            series={[
              {
                dataKey: 'conflicts',
                label: t('retroKpi.conflictFiled.seriesLabel'),
                color: '#8b5cf6',
              },
            ]}
            data={toRetroKpiPoints(windows, (w) => ({ conflicts: w.autoMergeConflictFiled }))}
          />

          <WeeklyMetricChart
            title={t('retroKpi.noChangeConfirmed.title')}
            icon={FlaskConical}
            iconBgClass={ICON_BG}
            iconColorClass={ICON_COLOR}
            valueFormat="count"
            emptyMessage={t('emptyChart')}
            noDataLabel={t('noData')}
            headerExtra={<KpiDiffBadge diff={noChangeDiff} label={vsLabel} valueFormat="count" />}
            series={[
              {
                dataKey: 'noChange',
                label: t('retroKpi.noChangeConfirmed.seriesLabel'),
                color: '#0ea5e9',
              },
            ]}
            data={toRetroKpiPoints(windows, (w) => ({ noChange: w.verifyNoChangeConfirmed }))}
          />

          <WeeklyMetricChart
            title={t('retroKpi.nonConvergence.title')}
            icon={Repeat}
            iconBgClass={ICON_BG}
            iconColorClass={ICON_COLOR}
            valueFormat="count"
            emptyMessage={t('emptyChart')}
            noDataLabel={t('noData')}
            headerExtra={
              <KpiDiffBadge diff={nonConvergenceDiff} label={vsLabel} valueFormat="count" />
            }
            series={[
              {
                dataKey: 'nonConvergence',
                label: t('retroKpi.nonConvergence.seriesLabel'),
                color: '#ef4444',
              },
            ]}
            data={toRetroKpiPoints(windows, (w) => ({
              nonConvergence: w.verifyRepairNonConvergence,
            }))}
          />

          <WeeklyMetricChart
            title={t('retroKpi.leadTime.title')}
            icon={TimerReset}
            iconBgClass={ICON_BG}
            iconColorClass={ICON_COLOR}
            valueFormat="minutes"
            emptyMessage={t('emptyChart')}
            noDataLabel={t('noData')}
            headerExtra={<KpiDiffBadge diff={leadTimeDiff} label={vsLabel} valueFormat="minutes" />}
            series={[
              { dataKey: 'median', label: t('retroKpi.leadTime.seriesLabel'), color: '#6366f1' },
            ]}
            data={toRetroKpiPoints(windows, (w) => ({ median: w.leadTimeMinutes.medianMinutes }))}
          />
        </div>
      )}
    </section>
  );
}
