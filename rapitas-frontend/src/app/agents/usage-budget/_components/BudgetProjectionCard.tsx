'use client';
/**
 * BudgetProjectionCard
 *
 * This month's progress against the budget: used / limit / remaining, the
 * reached level and the 7-day-average forecast. Display only.
 */
import { useTranslations } from 'next-intl';
import { formatBudgetAmount } from '@/components/providers/UsageBudgetPromptDialog';
import type { UsageBudgetStatus } from '../_hooks/useUsageBudget';

const LEVEL_BAR: Record<string, string> = {
  none: 'bg-emerald-500 dark:bg-emerald-400',
  warn80: 'bg-amber-500 dark:bg-amber-400',
  warn90: 'bg-orange-500 dark:bg-orange-400',
  exceeded: 'bg-red-500 dark:bg-red-400',
};

/**
 * Render the progress/forecast card.
 *
 * @param status - Status from /agent-metrics/usage-budget/status / 予算状態
 */
export function BudgetProjectionCard({ status }: { status: UsageBudgetStatus }) {
  const t = useTranslations('usageBudget');

  if (!status.configured) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
        {t('notConfigured')}
      </section>
    );
  }

  const p = status.projection;
  const amount = (v: number) => formatBudgetAmount(t, v, status.unit);
  const pct = Math.min(100, Math.round(p.ratio * 100));
  const stats: Array<[string, string]> = [
    [t('used'), amount(p.used)],
    [t('limit'), amount(p.limit)],
    [t('remaining'), amount(p.remaining)],
    [t('avg7'), amount(p.avg7)],
    [t('projectedMonthEnd'), p.projectedMonthEnd === null ? '—' : amount(p.projectedMonthEnd)],
  ];

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t('projectionTitle')} ({status.month})
        </h2>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t(`level_${p.level}`)}
        </span>
      </div>
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={`h-full ${LEVEL_BAR[p.level]}`} style={{ width: `${pct}%` }} />
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
            <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {p.daysToExhaust === null
          ? t('noForecast')
          : t('daysToExhaust', { days: String(Math.floor(p.daysToExhaust * 10) / 10) })}
      </p>
      {status.snoozedUntil && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t('snoozedUntil', { time: new Date(status.snoozedUntil).toLocaleString() })}
        </p>
      )}
    </section>
  );
}
