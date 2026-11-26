'use client';
/**
 * GoalList
 *
 * Per-goal rows under the metrics: milestone counts, last update and whether
 * the goal is stalled. Display only — the backend decides "stalled".
 */
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { InsightGoalRow } from '../_hooks/insights.types';

/**
 * Renders the per-goal list.
 *
 * @param goals - Rows from GET /goal-insights / ゴール別の行
 */
export function GoalList({ goals }: { goals: InsightGoalRow[] }) {
  const t = useTranslations('goals.insights.goalList');
  const format = useFormatter();
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('note')}</p>
      {goals.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-indigo-dark-900">
          {goals.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <Link
                  href={`/goals/detail?id=${g.id}`}
                  className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                >
                  {g.name}
                </Link>
                <p className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  {t('counts', { reached: g.reached, open: g.open, paused: g.paused })}
                  {' · '}
                  {t('updated', {
                    date: format.dateTime(new Date(g.lastUpdatedAt), { dateStyle: 'medium' }),
                  })}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  g.stalled
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                {g.stalled ? t('stalled') : t('active')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
