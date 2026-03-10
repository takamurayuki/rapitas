'use client';
import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp, Calendar, Target, Zap, Award } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';
import type { Theme } from '@/types';
import { createLogger } from '@/lib/logger';
const logger = createLogger('BurnupChart');

type BurnupData = {
  period: {
    start: string;
    end: string;
    days: number;
  };
  summary: {
    totalCompleted: number;
    totalAdded: number;
    currentRemaining: number;
    velocity: number;
    cumulativeCompleted: number;
  };
  dailyData: {
    date: string;
    completed: number; // その日の完了数
    cumulativeCompleted: number; // 累積完了数
    added: number;
  }[];
};

type BurnupChartProps = {
  themeId?: number;
  projectId?: number;
  days?: number;
  className?: string;
};

export default function BurnupChart({
  themeId,
  projectId,
  days = 14,
  className = '',
}: BurnupChartProps) {
  const t = useTranslations('burnupChart');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const [data, setData] = useState<BurnupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<number | undefined>(
    themeId,
  );
  const [selectedDays, setSelectedDays] = useState(days);

  useEffect(() => {
    const fetchThemes = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/themes`);
        if (res.ok) setThemes(await res.json());
      } catch (e) {
        logger.error('Failed to fetch themes:', e);
      }
    };
    fetchThemes();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ days: selectedDays.toString() });
        if (selectedThemeId)
          params.append('themeId', selectedThemeId.toString());
        if (projectId) params.append('projectId', projectId.toString());

        // バーンアップ用のAPIエンドポイントを使用
        const res = await fetch(`${API_BASE_URL}/statistics/burnup?${params}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch (e) {
        logger.error('Failed to fetch burnup data:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedThemeId, projectId, selectedDays]);

  // チャートの描画パラメータ
  const chartConfig = useMemo(() => {
    if (!data || data.dailyData.length === 0) return null;

    const padding = { top: 12, right: 16, bottom: 28, left: 36 };
    const width = 600;
    const height = 200;
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // バーンアップでは累積完了数の最大値を基準に
    const maxValue = Math.max(
      ...data.dailyData.map((d) => d.cumulativeCompleted),
      data.summary.cumulativeCompleted,
      1,
    );

    const xScale = (index: number) =>
      padding.left + (index / (data.dailyData.length - 1)) * chartWidth;
    const yScale = (value: number) =>
      padding.top + chartHeight - (value / maxValue) * chartHeight;

    // 累積完了数のパスを生成（右肩上がり）
    const completedPath = data.dailyData
      .map(
        (d, i) =>
          `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.cumulativeCompleted)}`,
      )
      .join(' ');

    // 理想的な進捗ライン（期間全体でのタスク追加を考慮した線形増加）
    const idealEndValue = data.summary.cumulativeCompleted;
    const idealPath = data.dailyData
      .map((d, i) => {
        const idealValue = (idealEndValue / (data.dailyData.length - 1)) * i;
        return `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(idealValue)}`;
      })
      .join(' ');

    // 累積完了数の下を塗りつぶすためのエリアパス（成果の可視化）
    const areaPath = `${completedPath} L ${xScale(data.dailyData.length - 1)} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

    // Y軸のグリッド線
    const yGridLines = [];
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const value = Math.round((maxValue / gridCount) * i);
      const y = yScale(value);
      yGridLines.push({ y, value });
    }

    return {
      width,
      height,
      padding,
      chartWidth,
      chartHeight,
      maxValue,
      xScale,
      yScale,
      idealPath,
      completedPath,
      areaPath,
      yGridLines,
    };
  }, [data]);

  if (loading) {
    return (
      <div className={`bg-white dark:bg-zinc-900 rounded-xl p-4 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3" />
          <div className="h-40 bg-zinc-200 dark:bg-zinc-700 rounded" />
        </div>
      </div>
    );
  }

  if (!data || !chartConfig) {
    return (
      <div className={`bg-white dark:bg-zinc-900 rounded-xl p-4 ${className}`}>
        <p className="text-zinc-500 dark:text-zinc-400 text-center text-sm">
          {t('noData')}
        </p>
      </div>
    );
  }

  const { summary, dailyData } = data;

  return (
    <div
      className={`bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200/50 dark:border-zinc-800 overflow-hidden ${className}`}
    >
      {/* ヘッダー: タイトル + サマリー + フィルター */}
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                {t('title')}
              </h2>
            </div>
            {/* インラインサマリー */}
            <div className="hidden sm:flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Award className="w-3 h-3" />
                {t('completed')}
                <span className="font-semibold">{summary.totalCompleted}</span>
              </span>
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <Calendar className="w-3 h-3" />
                {t('added')}
                <span className="font-semibold">{summary.totalAdded}</span>
              </span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                <Target className="w-3 h-3" />
                {t('remaining')}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {summary.currentRemaining}
                </span>
              </span>
              <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400">
                <Zap className="w-3 h-3" />
                <span className="font-semibold">{summary.velocity}</span>
                {t('perDay')}
              </span>
            </div>
          </div>

          {/* フィルター */}
          <div className="flex items-center gap-1.5">
            <select
              value={selectedThemeId || ''}
              onChange={(e) =>
                setSelectedThemeId(
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              className="px-2 py-1 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md"
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
                      ? 'bg-emerald-500 text-white'
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  }`}
                >
                  {t('days', { count: d })}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* モバイル用サマリー */}
        <div className="flex sm:hidden items-center gap-3 mt-2 text-xs">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            {t('completed')}
            <span className="font-semibold">{summary.totalCompleted}</span>
          </span>
          <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
            {t('added')}
            <span className="font-semibold">{summary.totalAdded}</span>
          </span>
          <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
            {t('remaining')}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {summary.currentRemaining}
            </span>
          </span>
          <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400">
            <span className="font-semibold">{summary.velocity}</span>
            {t('perDay')}
          </span>
        </div>
      </div>

      {/* チャート */}
      <div className="px-3 pt-2 pb-3">
        <svg
          viewBox={`0 0 ${chartConfig.width} ${chartConfig.height}`}
          className="w-full h-auto"
        >
          {/* グリッド線 */}
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

          {/* X軸ラベル */}
          {dailyData
            .filter(
              (_, i) =>
                i % Math.ceil(dailyData.length / 6) === 0 ||
                i === dailyData.length - 1,
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

          {/* 累積完了数エリア（塗りつぶし）- 成果の可視化 */}
          <path d={chartConfig.areaPath} fill="#10b981" fillOpacity={0.1} />

          {/* 理想線（参考線として） */}
          <path
            d={chartConfig.idealPath}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />

          {/* 実績線（累積完了数） - 右肩上がり */}
          <path
            d={chartConfig.completedPath}
            fill="none"
            stroke="#10b981"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* データポイント（間引き表示） */}
          {dailyData.map((d, i) => {
            const showDot =
              i === 0 ||
              i === dailyData.length - 1 ||
              i % Math.ceil(dailyData.length / 8) === 0;
            if (!showDot) return null;
            return (
              <circle
                key={d.date}
                cx={chartConfig.xScale(i)}
                cy={chartConfig.yScale(d.cumulativeCompleted)}
                r={3}
                fill="#10b981"
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

        {/* 凡例 */}
        <div className="flex items-center justify-center gap-4 mt-1">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-emerald-500 rounded" />
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {t('cumulativeCompleted')}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-zinc-400 rounded border-dashed" />
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {t('idealPace')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
