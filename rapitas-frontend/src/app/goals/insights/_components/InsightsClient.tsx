'use client';
/**
 * InsightsClient
 *
 * /goals/insights: the four measures of whether the product reaches its
 * purpose, with a period switch and a per-goal list. Display only —
 * rates come finished from the backend, and no maturity input is offered.
 */
import Link from 'next/link';
import { ChartLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useGoalInsights } from '../_hooks/useGoalInsights';
import type { InsightPeriod } from '../_hooks/insights.types';
import { GoalList } from './GoalList';
import { MetricCard, type MetricKey } from './MetricCard';

const PERIODS: InsightPeriod[] = ['4w', 'all'];
const METRIC_KEYS: MetricKey[] = ['reachRate', 'resumeRate', 'quality', 'feltProgress'];

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    active
      ? 'border-indigo-600 bg-indigo-600 text-white'
      : 'border-zinc-300 text-zinc-600 hover:border-indigo-400 dark:border-zinc-700 dark:text-zinc-300'
  }`;

/** Renders the insights page. */
export default function InsightsClient() {
  const t = useTranslations('goals.insights');
  const { data, isLoading, error, period, setPeriod } = useGoalInsights();
  const metrics = data?.overall;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-indigo-100 p-2.5 dark:bg-indigo-900/30">
          <ChartLine className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
        </div>
      </div>

      <div
        className="mb-6 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('period.label')}
      >
        {PERIODS.map((p) => (
          <button key={p} type="button" className={chip(period === p)} onClick={() => setPeriod(p)}>
            {t(`period.${p}`)}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {isLoading && !data ? (
        <LoadingSpinner />
      ) : (
        metrics && (
          <div className="grid gap-4 sm:grid-cols-2">
            {METRIC_KEYS.map((key) => (
              <MetricCard key={key} metricKey={key} metric={metrics[key]} />
            ))}
          </div>
        )
      )}

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">{t('limits')}</p>

      {data && <GoalList goals={data.goals} />}

      <Link
        href="/goals"
        className="mt-6 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400"
      >
        {t('back')}
      </Link>
    </div>
  );
}
