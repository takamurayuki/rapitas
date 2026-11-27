'use client';
/**
 * MetricCard
 *
 * One product-purpose metric: its rate with numerator / denominator, or — when
 * the backend has no material — 「まだ材料がありません」, never 0%.
 */
import { useTranslations } from 'next-intl';
import type { InsightMetric } from '../_hooks/insights.types';

/** Which metric a card shows; selects its title and help text. */
export type MetricKey = 'reachRate' | 'resumeRate' | 'quality' | 'feltProgress';

/**
 * Renders one metric card.
 *
 * @param metricKey - Which metric / 指標の種類
 * @param metric - The metric from the API / 指標の値
 */
export function MetricCard({ metricKey, metric }: { metricKey: MetricKey; metric: InsightMetric }) {
  const t = useTranslations('goals.insights');
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-indigo-dark-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {t(`metrics.${metricKey}.title`)}
      </h2>
      {metric.rate === null ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          {metric.reason === 'no-reflection-source' ? t('noReflection') : t('noMaterial')}
        </p>
      ) : (
        <>
          <p className="mt-3 text-3xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
            {t('percent', { percent: Math.round(metric.rate * 100) })}
          </p>
          <p className="mt-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {t('ratio', { numerator: metric.numerator, denominator: metric.denominator })}
          </p>
        </>
      )}
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {t(`metrics.${metricKey}.help`)}
      </p>
    </section>
  );
}
