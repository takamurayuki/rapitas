'use client';
// ImprovementDigest

/**
 * ImprovementDigest
 *
 * The one place to look on /agents/growth: a verdict for this week versus
 * last, a 0-100 improvement index (mean of the weekly rate metrics), its
 * trend, and three numbers — worked unattended, shipped, needed fixing.
 * Everything else on the page is evidence and stays collapsed. Renders
 * nothing it cannot back with data. Not responsible for the metric maths
 * (improvement-digest.ts).
 */
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GrowthLedgerWindow, RetroKpiWindow } from '../types';
import { KpiDiffBadge } from './KpiDiffBadge';
import { formatWeekLabel } from './retro-kpi-points';
import { WeeklyMetricChart } from './WeeklyMetricChart';
import { computeImprovementDigest, toKpiDiff, type DigestVerdict } from './improvement-digest';

interface ImprovementDigestProps {
  growthWindows: GrowthLedgerWindow[];
  retroWindows: RetroKpiWindow[];
}

// Status colors are reserved for the verdict (good / neutral / serious) and
// travel with an icon + label, never color alone.
const VERDICT_STYLE: Record<DigestVerdict, { chip: string; Icon: typeof ArrowUpRight }> = {
  improving: {
    chip: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    Icon: ArrowUpRight,
  },
  worsening: {
    chip: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    Icon: ArrowDownRight,
  },
  flat: { chip: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300', Icon: Minus },
  insufficient: {
    chip: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    Icon: Minus,
  },
};

const formatTile = (v: number | null, format: 'count' | 'percent'): string => {
  if (v === null) return '—';
  if (format === 'percent') return `${Math.round(v * 100)}%`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/**
 * Improvement digest: verdict, index hero, trend, three key numbers.
 *
 * @param props - Both ledgers' weekly windows, newest first.
 */
export function ImprovementDigest({ growthWindows, retroWindows }: ImprovementDigestProps) {
  const t = useTranslations('agents.growth.digest');
  const digest = computeImprovementDigest(growthWindows, retroWindows, formatWeekLabel);
  const { chip, Icon } = VERDICT_STYLE[digest.verdict];
  const delta =
    digest.latestIndex !== null && digest.previousIndex !== null
      ? digest.latestIndex - digest.previousIndex
      : null;

  return (
    <section
      aria-label={t('title')}
      className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-indigo-dark-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${chip}`}
          data-testid="digest-verdict"
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {t(`verdict.${digest.verdict}`)}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t('indexLabel')}
          </p>
          <p className="mt-1 text-5xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
            {digest.latestIndex ?? '—'}
            <span className="ml-1 text-base font-normal text-zinc-400">/ 100</span>
          </p>
          {delta !== null && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('vsPrevWeek')} {delta > 0 ? '+' : ''}
              {delta}pt
            </p>
          )}
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{t('indexHint')}</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {digest.tiles.map((tile) => (
              <div
                key={tile.key}
                className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"
              >
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t(`tiles.${tile.key}`)}</p>
                <p className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatTile(tile.current, tile.valueFormat)}
                </p>
                <KpiDiffBadge
                  diff={toKpiDiff(tile)}
                  label={t('vsPrevWeek')}
                  valueFormat={tile.valueFormat}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <WeeklyMetricChart
            title={t('chartTitle')}
            icon={ChartNoAxesCombined}
            iconBgClass="bg-indigo-100 dark:bg-indigo-900/30"
            iconColorClass="text-indigo-600 dark:text-indigo-400"
            valueFormat="count"
            emptyMessage={t('emptyChart')}
            noDataLabel={t('noData')}
            series={[{ dataKey: 'index', label: t('indexLabel'), color: '#6366f1' }]}
            data={digest.indexSeries}
          />
        </div>
      </div>
    </section>
  );
}
