/**
 * use-burnup-data
 *
 * Data fetching and SVG chart geometry for the burnup chart widget.
 * Rendering is owned by burnup-chart.tsx.
 */
'use client';
import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { Theme } from '@/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('BurnupChart');

export type BurnupData = {
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
    completed: number;
    cumulativeCompleted: number;
    added: number;
  }[];
};

export type BurnupChartConfig = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  chartWidth: number;
  chartHeight: number;
  maxValue: number;
  xScale: (index: number) => number;
  yScale: (value: number) => number;
  idealPath: string;
  completedPath: string;
  areaPath: string;
  yGridLines: { y: number; value: number }[];
};

/**
 * Fetch burnup statistics + themes and derive the SVG chart geometry.
 *
 * @param selectedThemeId - Theme filter, undefined for all themes. / テーマフィルタ（未指定で全テーマ）。
 * @param projectId - Optional project filter. / 任意のプロジェクトフィルタ。
 * @param selectedDays - Period length in days. / 期間（日数）。
 * @returns Burnup data, loading flag, themes, and the derived chart config. / バーンアップデータ・ローディング・テーマ一覧・チャート設定。
 */
export function useBurnupData(
  selectedThemeId: number | undefined,
  projectId: number | undefined,
  selectedDays: number,
) {
  const [data, setData] = useState<BurnupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [themes, setThemes] = useState<Theme[]>([]);

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
        if (selectedThemeId) params.append('themeId', selectedThemeId.toString());
        if (projectId) params.append('projectId', projectId.toString());

        // Use the burnup statistics API endpoint
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

  const chartConfig = useMemo<BurnupChartConfig | null>(() => {
    if (!data || data.dailyData.length === 0) return null;

    const padding = { top: 12, right: 16, bottom: 28, left: 36 };
    const width = 600;
    const height = 200;
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Scale Y-axis based on the max cumulative completed count
    const maxValue = Math.max(
      ...data.dailyData.map((d) => d.cumulativeCompleted),
      data.summary.cumulativeCompleted,
      1,
    );

    const xScale = (index: number) =>
      padding.left + (index / (data.dailyData.length - 1)) * chartWidth;
    const yScale = (value: number) => padding.top + chartHeight - (value / maxValue) * chartHeight;

    // Generate SVG path for cumulative completed (ascending line)
    const completedPath = data.dailyData
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.cumulativeCompleted)}`)
      .join(' ');

    // Ideal progress line (linear increase accounting for task additions over the period)
    const idealEndValue = data.summary.cumulativeCompleted;
    const idealPath = data.dailyData
      .map((d, i) => {
        const idealValue = (idealEndValue / (data.dailyData.length - 1)) * i;
        return `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(idealValue)}`;
      })
      .join(' ');

    // Area fill path under cumulative completed line (visualizes progress)
    const areaPath = `${completedPath} L ${xScale(data.dailyData.length - 1)} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

    // Y-axis grid lines
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

  return { data, loading, themes, chartConfig };
}
