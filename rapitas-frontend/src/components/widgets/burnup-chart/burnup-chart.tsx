/**
 * BurnupChart
 *
 * Cumulative-completion burnup chart card with theme/period filters.
 * Data fetching and geometry live in use-burnup-data.
 */
'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import { BurnupSummary } from './burnup-summary';
import { useBurnupData } from './use-burnup-data';

type BurnupChartProps = {
  themeId?: number;
  projectId?: number;
  days?: number;
  className?: string;
};

/**
 * Render the burnup chart widget.
 *
 * @param props - Optional theme/project filters, period, and extra classes. / テーマ・プロジェクトフィルタ、期間、追加クラス。
 */
export default function BurnupChart({
  themeId,
  projectId,
  days = 14,
  className = '',
}: BurnupChartProps) {
  const t = useTranslations('burnupChart');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const [selectedThemeId, setSelectedThemeId] = useState<number | undefined>(themeId);
  const [selectedDays, setSelectedDays] = useState(days);
  const { data, loading, themes, chartConfig } = useBurnupData(
    selectedThemeId,
    projectId,
    selectedDays,
  );

  if (loading) {
    return (
      <div
        className={`rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
      >
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3" />
          <div className="h-40 bg-zinc-200 dark:bg-zinc-700 rounded" />
        </div>
      </div>
    );
  }

  if (!data || !chartConfig) {
    return (
      <div
        className={`rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
      >
        <p className="text-zinc-500 dark:text-zinc-400 text-center text-sm">{t('noData')}</p>
      </div>
    );
  }

  const { summary, dailyData } = data;

  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {/* Header: title + summary + filters */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
              <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                {t('title')}
              </h2>
            </div>
            {/* Inline summary */}
            <BurnupSummary summary={summary} withIcons className="hidden sm:flex" />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-1.5">
            <select
              value={selectedThemeId || ''}
              onChange={(e) =>
                setSelectedThemeId(e.target.value ? parseInt(e.target.value) : undefined)
              }
              className="px-2 py-1 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="">{t('allThemes')}</option>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
            <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDays(d)}
                  className={`px-2 py-1 text-xs transition-colors ${
                    selectedDays === d
                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  }`}
                >
                  {t('days', { count: d })}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Mobile summary */}
        <BurnupSummary summary={summary} className="flex sm:hidden mt-2" />
      </div>

      {/* Chart */}
      <div className="px-3 pt-2 pb-3">
        <svg viewBox={`0 0 ${chartConfig.width} ${chartConfig.height}`} className="w-full h-auto">
          {/* Grid lines */}
          {chartConfig.yGridLines.map(({ y, value }, index) => (
            <g key={`grid-${index}-${value}`}>
              <line
                x1={chartConfig.padding.left}
                y1={y}
                x2={chartConfig.width - chartConfig.padding.right}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeDasharray="3"
              />
              <text
                x={chartConfig.padding.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="text-[9px] fill-zinc-400"
              >
                {value}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {dailyData
            .filter(
              (_, i) => i % Math.ceil(dailyData.length / 6) === 0 || i === dailyData.length - 1,
            )
            .map((d) => {
              const originalIndex = dailyData.indexOf(d);
              return (
                <text
                  key={d.date}
                  x={chartConfig.xScale(originalIndex)}
                  y={chartConfig.height - 6}
                  textAnchor="middle"
                  className="text-[9px] fill-zinc-400"
                >
                  {new Date(d.date).toLocaleDateString(dateLocale, {
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </text>
              );
            })}

          {/* Cumulative completed area fill */}
          <path d={chartConfig.areaPath} fill="#22c55e" fillOpacity={0.1} />

          {/* Ideal pace reference line */}
          <path
            d={chartConfig.idealPath}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />

          {/* Actual progress line (cumulative completed) */}
          <path
            d={chartConfig.completedPath}
            fill="none"
            stroke="#22c55e"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points (thinned for readability) */}
          {dailyData.map((d, i) => {
            const showDot =
              i === 0 || i === dailyData.length - 1 || i % Math.ceil(dailyData.length / 8) === 0;
            if (!showDot) return null;
            return (
              <circle
                key={d.date}
                cx={chartConfig.xScale(i)}
                cy={chartConfig.yScale(d.cumulativeCompleted)}
                r={3}
                fill="#22c55e"
                stroke="white"
                strokeWidth={1.5}
                className="cursor-pointer"
              >
                <title>
                  {t('cumulativeTooltip', {
                    date: new Date(d.date).toLocaleDateString(dateLocale),
                    count: d.cumulativeCompleted,
                  })}
                </title>
              </circle>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-1">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-green-500 rounded" />
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {t('cumulativeCompleted')}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-zinc-400 rounded border-dashed" />
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{t('idealPace')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
