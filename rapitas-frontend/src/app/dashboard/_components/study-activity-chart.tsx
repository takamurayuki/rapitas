/**
 * StudyActivityChart
 *
 * Two-week study-hours bar chart card for the dashboard. Pure presentational.
 */
'use client';
import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import type { DailyStudy } from './use-dashboard-data';

interface StudyActivityChartProps {
  dailyStudy: DailyStudy[];
}

/**
 * Render the past-two-weeks study bar chart.
 *
 * @param props - The daily study series from useDashboardData. / 日次学習時間の系列。
 */
export function StudyActivityChart({ dailyStudy }: StudyActivityChartProps) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(dateLocale, {
      month: 'short',
      day: 'numeric',
    });
  };

  const maxHours = Math.max(...dailyStudy.map((d) => d.hours), 1);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
        <Clock className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
        {t('pastTwoWeeks')}
      </h2>

      {dailyStudy.length > 0 ? (
        <div className="space-y-2">
          <div className="flex h-40 items-end justify-between gap-1">
            {dailyStudy.map((day, index) => {
              const height = day.hours > 0 ? (day.hours / maxHours) * 100 : 2;
              const isToday = index === dailyStudy.length - 1;
              return (
                <div key={day.date} className="flex flex-1 flex-col items-center">
                  <div
                    className={`w-full rounded-t-md ${
                      isToday
                        ? 'bg-indigo-500'
                        : day.hours > 0
                          ? 'bg-indigo-300 dark:bg-indigo-600'
                          : 'bg-zinc-200 dark:bg-zinc-800'
                    }`}
                    style={{ height: `${height}%` }}
                    title={`${day.hours}${tc('hours')}`}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex justify-between border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {dailyStudy.map((day, index) => (
              <div key={day.date} className="flex-1 text-center">
                {index % 2 === 0 && formatDate(day.date)}
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
            <span>
              {dailyStudy.reduce((sum, d) => sum + d.hours, 0).toFixed(1)}
              {tc('hours')}
            </span>
            <span>
              {(dailyStudy.reduce((sum, d) => sum + d.hours, 0) / dailyStudy.length).toFixed(1)}
              {tc('hoursPerDay')}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center text-zinc-500 dark:text-zinc-400">
          {t('noRecords')}
        </div>
      )}
    </div>
  );
}
