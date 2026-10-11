'use client';
/**
 * ThemeDailyUsageTable
 *
 * Daily × theme usage table (tokens / runs / duration). Cost is shown only for
 * cells whose actual cost was recorded; when no cost is known at all the table
 * stays in tokens and says why, so an unrecorded cost never reads as ¥0.
 */
import { useTranslations } from 'next-intl';
import type { ThemeUsageData, UsageCell } from '../_hooks/useUsageBudget';

export const PERIOD_OPTIONS = [7, 14, 30] as const;

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Display label of a theme id.
 *
 * @param t - usageBudget translator / 翻訳関数
 * @param themeId - Theme id (0 = 未分類) / テーマID
 * @param name - Theme name when known / テーマ名
 * @returns Label / 表示名
 */
export function themeLabel(t: Translate, themeId: number, name: string | null | undefined): string {
  if (themeId === 0) return t('unclassified');
  return name ?? t('unknownTheme', { id: themeId });
}

function yen(cell: UsageCell, rate: number): string {
  return `¥${Math.round(cell.costUsd * rate).toLocaleString()}`;
}

interface Props {
  usage: ThemeUsageData;
  days: number;
  onDaysChange: (days: number) => void;
}

/**
 * Render the daily × theme table.
 *
 * @param usage - Aggregation from /agent-metrics/theme-usage / 集計結果
 * @param days - Selected period / 表示期間
 * @param onDaysChange - Period change handler / 期間変更
 */
export function ThemeDailyUsageTable({ usage, days, onDaysChange }: Props) {
  const t = useTranslations('usageBudget');
  const names = new Map(usage.themes.map((x) => [x.themeId, x.themeName]));
  const known = usage.themes.reduce((a, x) => a + x.costKnownCount, 0);
  const total = usage.themes.reduce((a, x) => a + x.executionCount, 0);
  const showCost = known > 0;
  const rows = [...usage.daily].reverse().flatMap((d) =>
    Object.entries(d.byTheme)
      .sort(([, a], [, b]) => b.tokens - a.tokens)
      .map(([themeId, c]) => ({ date: d.date, themeId: Number(themeId), c })),
  );
  const cellClass = 'px-3 py-2 text-right tabular-nums';

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t('dailyTitle')}
        </h2>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          {t('periodLabel')}
          <select
            value={days}
            onChange={(e) => onDaysChange(Number(e.target.value))}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {PERIOD_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t('periodDays', { days: d })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{t('noUsage')}</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-sm text-zinc-700 dark:text-zinc-300">
            <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 text-left">{t('colDate')}</th>
                <th className="px-3 py-2 text-left">{t('colTheme')}</th>
                <th className={cellClass}>{t('colTokens')}</th>
                <th className={cellClass}>{t('colExecutions')}</th>
                <th className={cellClass}>{t('colDuration')}</th>
                {showCost && <th className={cellClass}>{t('colCost')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ date, themeId, c }) => (
                <tr
                  key={`${date}-${themeId}`}
                  data-testid={`usage-row-${date}-${themeId}`}
                  className="border-t border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-3 py-2">{date}</td>
                  <td className="px-3 py-2">{themeLabel(t, themeId, names.get(themeId))}</td>
                  <td className={cellClass}>{c.tokens.toLocaleString()}</td>
                  <td className={cellClass}>{c.executions.toLocaleString()}</td>
                  <td className={cellClass}>
                    {t('durationMinutes', { value: String(Math.round(c.durationMs / 60_000)) })}
                  </td>
                  {showCost && (
                    <td className={cellClass}>
                      {c.costKnownCount > 0 ? yen(c, usage.usdJpyRate) : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        {total > 0 && !showCost && <p>{t('costUnavailable')}</p>}
        {showCost && known < total && <p>{t('costPartial', { known, total })}</p>}
        {usage.unresolvedCount > 0 && (
          <p>{t('unresolvedNote', { count: usage.unresolvedCount })}</p>
        )}
      </div>
    </section>
  );
}
