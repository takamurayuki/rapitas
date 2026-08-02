'use client';

/**
 * RoadmapAnalytics
 *
 * Science-based study analytics for the roadmap: stat tiles (streak, 7-day
 * pace vs quota, adherence, cramming index), a 30-day study-minutes chart,
 * and technique-tagged recommendations (spacing / retrieval / consistency /
 * pacing). Data comes from GET /study-goals/analytics.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info, Flame } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import type { RoadmapAnalytics as Payload, RoadmapRecommendation } from './roadmap.types';

// Same single-hue series color validated for both surfaces (dataviz checks).
const SERIES_COLOR = '#6366f1';
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-zinc-800, #27272a)',
  border: '1px solid var(--color-zinc-700, #3f3f46)',
  borderRadius: '8px',
  color: '#f4f4f5',
  fontSize: '13px',
};

/** Technique chip colors — labels always accompany the color. */
const TECHNIQUE_STYLE: Record<RoadmapRecommendation['technique'], string> = {
  spacing: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  retrieval: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  consistency: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  pacing: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  zeigarnik: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  interleaving: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
  chunking: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  none: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

interface RoadmapAnalyticsProps {
  /** Bump to force a refetch (e.g. after logging study time). */
  refreshToken?: number;
}

/**
 * Render the analytics block (self-fetching).
 *
 * @param props - Optional refresh token. / 再取得トリガー。
 */
export function RoadmapAnalytics({ refreshToken = 0 }: RoadmapAnalyticsProps) {
  const t = useTranslations('learningRoadmap.analytics');
  const [data, setData] = useState<Payload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/study-goals/analytics`);
        if (res.ok) setData((await res.json()) as Payload);
      } catch {
        /* non-critical */
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refreshToken]);

  if (isLoading || !data) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {isLoading ? '…' : t('empty')}
      </p>
    );
  }

  const recText = (rec: RoadmapRecommendation) => t(`recs.${rec.key}`, rec.params);
  const chart = data.series.map((p) => ({ label: p.date.slice(5).replace('-', '/'), ...p }));

  return (
    <div className="flex flex-col gap-4">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-indigo-dark-900">
          <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Flame className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            {t('tiles.streak')}
          </div>
          <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {t('tiles.streakDays', { days: data.pace.streakDays })}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-indigo-dark-900">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{t('tiles.avg7d')}</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {t('tiles.minutes', { min: data.pace.avg7d })}
            {data.pace.quotaMinutes > 0 && (
              <span className="ml-1 text-xs font-normal text-zinc-500">
                / {t('tiles.minutes', { min: data.pace.quotaMinutes })}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-indigo-dark-900">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{t('tiles.adherence')}</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {data.pace.adherence7d}%
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-indigo-dark-900">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{t('tiles.cramming')}</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {data.pace.crammingIndex != null ? `${data.pace.crammingIndex}%` : '—'}
          </div>
        </div>
      </div>

      {/* Recommendations — each tagged with the technique it draws on */}
      <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900/40">
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t('recsTitle')}
        </h3>
        <ul className="space-y-1.5">
          {data.recommendations.map((rec, i) => (
            <li key={`${rec.key}-${i}`} className="flex items-start gap-2 text-sm">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-400"
                aria-hidden="true"
              />
              <span className="text-zinc-700 dark:text-zinc-300">
                {rec.technique !== 'none' && (
                  <span
                    className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${TECHNIQUE_STYLE[rec.technique]}`}
                  >
                    {t(`techniques.${rec.technique}`)}
                  </span>
                )}
                {recText(rec)}
                {rec.key === 'retrievalBacklog' && (
                  <Link
                    href="/vocabulary"
                    className="ml-1.5 text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {t('goReview')}
                  </Link>
                )}
                {rec.key === 'zeigarnikResume' && (
                  <Link
                    href="/"
                    className="ml-1.5 text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {t('goTasks')}
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 30-day study minutes */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-indigo-dark-900">
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t('chartTitle')}
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={chart}
            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
            barCategoryGap="20%"
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} className="fill-zinc-500" interval={4} />
            <YAxis tick={{ fontSize: 10 }} className="fill-zinc-500" />
            <Tooltip
              cursor={{ fill: 'rgba(113, 113, 122, 0.08)' }}
              contentStyle={TOOLTIP_STYLE}
              formatter={
                ((v: unknown) => [
                  t('tiles.minutes', { min: Number(v) }),
                  t('chartSeries'),
                ]) as never
              }
            />
            <Bar dataKey="minutes" fill={SERIES_COLOR} radius={[3, 3, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
