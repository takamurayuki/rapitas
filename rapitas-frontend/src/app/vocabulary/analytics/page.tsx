'use client';

/**
 * VocabAnalyticsPage
 *
 * Learning analytics for the vocabulary book: stat tiles, the personal
 * forgetting curve vs the Ebbinghaus reference, time-of-day performance,
 * hardest cards, and rule-based study recommendations.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ChartSpline, Info } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useVocabAnalytics } from '../_components/use-vocab-analytics';
import { HourBarChart, RetentionCurveChart } from '../_components/analytics-charts';

export default function VocabAnalyticsPage() {
  const t = useTranslations('vocabulary.analytics');
  const { data, isLoading } = useVocabAnalytics();

  const hasCurve = (data?.curve ?? []).some((p) => p.rate != null);

  const recommendationText = (rec: { key: string; params?: Record<string, string | number> }) => {
    if (rec.key === 'reviewBefore') {
      return t('recommendations.reviewBefore', {
        bucket: t(`buckets.${String(rec.params?.bucket ?? 'd7')}`),
      });
    }
    if (rec.key === 'bestTime') {
      return t('recommendations.bestTime', {
        period: t(`periods.${String(rec.params?.period ?? 'morning')}`),
        rate: rec.params?.rate ?? 0,
      });
    }
    return t(`recommendations.${rec.key}`, rec.params);
  };

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-4xl px-3 sm:px-4 md:px-6 py-4">
        <Link
          href="/vocabulary"
          className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToList')}
        </Link>

        <div className="mb-5 flex items-center gap-2.5">
          <ChartSpline className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="md" />
          </div>
        ) : !data ? (
          <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t('curveEmpty')}
          </p>
        ) : (
          <>
            {/* Stat tiles */}
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: t('tiles.totalReviews'), value: String(data.totalReviews) },
                {
                  label: t('tiles.retention'),
                  value: data.overallRetention != null ? `${data.overallRetention}%` : '—',
                },
                {
                  label: t('tiles.stability'),
                  value:
                    data.stability != null
                      ? t('tiles.stabilityDays', { days: data.stability })
                      : '—',
                },
                { label: t('tiles.retentionReviews'), value: String(data.retentionReviews) },
              ].map((tile) => (
                <div
                  key={tile.label}
                  className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</div>
                  <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                    {tile.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Recommendations */}
            <div className="mb-5 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900/40">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t('recommendationsTitle')}
              </h2>
              <ul className="space-y-1.5">
                {data.recommendations.map((rec, i) => (
                  <li
                    key={`${rec.key}-${i}`}
                    className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-400" />
                    {recommendationText(rec)}
                  </li>
                ))}
              </ul>
            </div>

            {/* Retention curve */}
            <div className="mb-5 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t('curveTitle')}
              </h2>
              {hasCurve ? (
                <RetentionCurveChart curve={data.curve} />
              ) : (
                <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {t('curveEmpty')}
                </p>
              )}
            </div>

            {/* Time-of-day performance */}
            <div className="mb-5 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t('hoursTitle')}
              </h2>
              {data.hours.some((h) => h.rate != null) ? (
                <HourBarChart hours={data.hours} />
              ) : (
                <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {t('curveEmpty')}
                </p>
              )}
            </div>

            {/* Hardest cards */}
            {data.hardest.length > 0 && (
              <div className="mb-5 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t('hardestTitle')}
                </h2>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {data.hardest.map((c) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {c.front}
                        </span>
                        <span className="ml-3 whitespace-pre-line text-sm text-zinc-500 dark:text-zinc-400">
                          {c.back}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
                        {t('lapseCount', { count: c.lapses })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
