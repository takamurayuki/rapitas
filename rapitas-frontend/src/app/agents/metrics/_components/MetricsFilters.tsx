'use client';
// MetricsFilters
import { Filter } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DateRange } from '../_hooks/useMetricsData';

interface MetricsFiltersProps {
  dateRange: DateRange;
  trendDays: number;
  setDateRange: (updater: (prev: DateRange) => DateRange) => void;
  setTrendDays: (days: number) => void;
}

/**
 * Renders the date range and period filter form for the metrics page.
 *
 * @param props - Current filter state and setter callbacks
 */
export function MetricsFilters({
  dateRange,
  trendDays,
  setDateRange,
  setTrendDays,
}: MetricsFiltersProps) {
  const t = useTranslations('agents');

  return (
    <div className="mb-8 p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-3 mb-4">
        <Filter className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
          {t('filterSettings')}
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            {t('startDate')}
          </label>
          <input
            type="date"
            value={dateRange.startDate}
            onChange={(e) =>
              setDateRange((prev) => ({
                ...prev,
                startDate: e.target.value,
              }))
            }
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            {t('endDate')}
          </label>
          <input
            type="date"
            value={dateRange.endDate}
            onChange={(e) =>
              setDateRange((prev) => ({ ...prev, endDate: e.target.value }))
            }
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            {t('period')}
          </label>
          <select
            value={dateRange.period}
            onChange={(e) =>
              setDateRange((prev) => ({
                ...prev,
                period: e.target.value as 'day' | 'week' | 'month',
              }))
            }
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
          >
            <option value="day">{t('periodDay')}</option>
            <option value="week">{t('periodWeek')}</option>
            <option value="month">{t('periodMonth')}</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            {t('trendDays')}
          </label>
          <input
            type="number"
            min="1"
            max="365"
            value={trendDays}
            onChange={(e) => setTrendDays(parseInt(e.target.value) || 30)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
          />
        </div>
      </div>
    </div>
  );
}
