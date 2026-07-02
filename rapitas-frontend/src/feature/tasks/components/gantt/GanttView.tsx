/**
 * GanttView - Gantt chart data shell.
 *
 * Owns: SWR data fetching, zoom/date-nav controls, container-size state,
 * and the task detail slide panel. Delegates SVG rendering to GanttChart.
 */

'use client';

import React, { useState, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GanttData } from '@/types/task.types';
import TaskSlidePanel from '@/feature/tasks/components/detail/TaskSlidePanel';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import { GanttChart } from './GanttChart';
import type { GanttViewport } from './gantt-utils';

const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : '';

interface GanttViewProps {
  themeId?: number;
  categoryId?: number;
  className?: string;
}

type ZoomLevel = 'day' | 'week' | 'month';

const ZOOM_DAYS: Record<ZoomLevel, number> = { day: 7, week: 30, month: 90 };

export function GanttView({ themeId, categoryId, className = '' }: GanttViewProps) {
  const t = useTranslations('task.ganttView');
  const locale = useLocaleStore((s) => s.locale);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('week');
  const [viewDate, setViewDate] = useState(new Date());
  const [containerSize, setContainerSize] = useState({ width: 800, height: 400 });
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const { showTaskDetail, hideTaskDetail } = useTaskDetailVisibilityStore();

  const dateRange = useMemo(() => {
    const days = ZOOM_DAYS[zoomLevel];
    return {
      from: new Date(viewDate.getTime() - days * 86_400_000).toISOString(),
      to: new Date(viewDate.getTime() + days * 86_400_000).toISOString(),
    };
  }, [viewDate, zoomLevel]);

  // NOTE: Build the SWR key explicitly so themeId=0 and undefined are handled
  // unambiguously, and URLSearchParams receives only string values.
  const swrKey = useMemo(() => {
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    if (themeId != null) params.set('themeId', String(themeId));
    if (categoryId != null) params.set('categoryId', String(categoryId));
    return `/gantt-data?${params.toString()}`;
  }, [themeId, categoryId, dateRange.from, dateRange.to]);

  const {
    data: ganttData,
    error,
    isLoading,
  } = useSWR<GanttData>(
    swrKey,
    async (url: string) => {
      const res = await fetch(`${API_BASE}${url}`);
      if (!res.ok) throw new Error(`Failed to fetch gantt data: ${res.statusText}`);
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  const viewport: GanttViewport = {
    startDate: new Date(dateRange.from),
    endDate: new Date(dateRange.to),
    width: containerSize.width,
    // NOTE: 2-row header (80px) + rows + bottom margin; min 400 to avoid empty chart.
    height: Math.max(400, (ganttData?.tasks.length || 0) * 40 + 120),
    rowHeight: 40,
    margin: { top: 80, right: 40, bottom: 40, left: 200 },
  };

  const handleResize = useCallback((width: number, height: number) => {
    setContainerSize({ width, height });
  }, []);

  const openTaskPanel = useCallback(
    (taskId: number) => {
      setSelectedTaskId(taskId);
      setIsPanelOpen(true);
      showTaskDetail();
    },
    [showTaskDetail],
  );

  const closeTaskPanel = useCallback(() => {
    setIsPanelOpen(false);
    hideTaskDetail();
    setTimeout(() => setSelectedTaskId(null), 300);
  }, [hideTaskDetail]);

  const navigate = (direction: 'prev' | 'next') => {
    const ms = ZOOM_DAYS[zoomLevel] * 86_400_000;
    setViewDate((d) => new Date(d.getTime() + (direction === 'next' ? ms : -ms)));
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        <span className="ml-3 text-gray-600 dark:text-gray-400">{t('loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 ${className}`}
      >
        <p className="text-red-800 dark:text-red-300">
          {t('fetchFailed', { message: error.message })}
        </p>
      </div>
    );
  }

  if (!ganttData || ganttData.tasks.length === 0) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <p className="text-gray-500 dark:text-gray-400">{t('empty')}</p>
      </div>
    );
  }

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 ${className}`}
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {t('taskCount', { count: ganttData.metadata.totalTasks })}
          </div>
        </div>

        {/* コントロール */}
        <div className="flex items-center space-x-3">
          {/* 日付ナビゲーション */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => navigate('prev')}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title={t('prevPeriod')}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[120px] text-center">
              {viewDate.toLocaleDateString(toDateLocale(locale), {
                year: 'numeric',
                month: 'long',
              })}
            </span>
            <button
              onClick={() => navigate('next')}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title={t('nextPeriod')}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* ズームレベル */}
          <div className="flex border border-gray-300 dark:border-gray-600 rounded-md">
            {(['day', 'week', 'month'] as ZoomLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => setZoomLevel(level)}
                className={`px-3 py-1 text-sm ${
                  zoomLevel === level
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                } first:rounded-l-md last:rounded-r-md`}
              >
                {level === 'day' ? t('zoomDay') : level === 'week' ? t('zoomWeek') : t('zoomMonth')}
              </button>
            ))}
          </div>

          {/* 今日にリセット */}
          <button
            onClick={() => setViewDate(new Date())}
            className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            {t('today')}
          </button>
        </div>
      </div>

      <GanttChart
        ganttData={ganttData}
        viewport={viewport}
        zoomLevel={zoomLevel}
        viewDate={viewDate}
        onViewDateChange={setViewDate}
        onTaskClick={openTaskPanel}
        onResize={handleResize}
      />

      <TaskSlidePanel taskId={selectedTaskId} isOpen={isPanelOpen} onClose={closeTaskPanel} />
    </div>
  );
}
