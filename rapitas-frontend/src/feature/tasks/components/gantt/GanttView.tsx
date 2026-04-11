/**
 * GanttView - メインのガントチャートコンポーネント
 *
 * タスクデータを取得し、ガントチャート全体をレンダリングする
 */

import React, { useState, useRef, useEffect } from 'react';
import useSWR from 'swr';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Loader2,
} from 'lucide-react';
import type { GanttData, GanttTask } from '@/types/task.types';
import { GanttBar } from './GanttBar';
import { GanttArrows } from './GanttArrows';
import {
  adjustDateRange,
  taskToBar,
  getWeekGridLines,
  getDayGridLines,
  type GanttViewport,
} from './gantt-utils';

const API_BASE =
  process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : '';

interface GanttViewProps {
  themeId?: number;
  categoryId?: number;
  className?: string;
}

type ZoomLevel = 'day' | 'week' | 'month';

export function GanttView({
  themeId,
  categoryId,
  className = '',
}: GanttViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('week');
  const [viewDate, setViewDate] = useState(new Date());

  // ズームレベルに基づく日付範囲の計算
  const getDateRangeForZoom = (centerDate: Date, zoom: ZoomLevel) => {
    const center = new Date(centerDate);
    let daysBefore: number, daysAfter: number;

    switch (zoom) {
      case 'day':
        daysBefore = 7;
        daysAfter = 7;
        break;
      case 'week':
        daysBefore = 30;
        daysAfter = 30;
        break;
      case 'month':
        daysBefore = 90;
        daysAfter = 90;
        break;
    }

    return {
      from: new Date(
        center.getTime() - daysBefore * 24 * 60 * 60 * 1000,
      ).toISOString(),
      to: new Date(
        center.getTime() + daysAfter * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
  };

  const dateRange = getDateRangeForZoom(viewDate, zoomLevel);

  // ガントデータの取得
  const {
    data: ganttData,
    error,
    isLoading,
  } = useSWR<GanttData>(
    `/gantt-data?${new URLSearchParams({
      ...(themeId && { themeId: themeId.toString() }),
      ...(categoryId && { categoryId: categoryId.toString() }),
      from: dateRange.from,
      to: dateRange.to,
    })}`,
    async (url: string) => {
      const response = await fetch(`${API_BASE}${url}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch gantt data: ${response.statusText}`);
      }
      return response.json();
    },
  );

  // ビューポートの計算
  const [containerSize, setContainerSize] = useState({
    width: 800,
    height: 400,
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const viewport: GanttViewport = {
    startDate: new Date(dateRange.from),
    endDate: new Date(dateRange.to),
    width: containerSize.width,
    height: Math.max(400, (ganttData?.tasks.length || 0) * 40 + 120),
    rowHeight: 40,
    margin: { top: 80, right: 40, bottom: 40, left: 200 },
  };

  // ナビゲーション関数
  const navigateDate = (direction: 'prev' | 'next') => {
    const days = zoomLevel === 'day' ? 7 : zoomLevel === 'week' ? 30 : 90;
    const multiplier = direction === 'prev' ? -1 : 1;
    const newDate = new Date(
      viewDate.getTime() + multiplier * days * 24 * 60 * 60 * 1000,
    );
    setViewDate(newDate);
  };

  const handleTaskClick = (taskId: number) => {
    // タスク詳細ページに遷移
    window.open(`/tasks/${taskId}`, '_blank');
  };

  // ローディング状態
  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        <span className="ml-3 text-gray-600 dark:text-gray-400">
          ガントチャートを読み込み中...
        </span>
      </div>
    );
  }

  // エラー状態
  if (error) {
    return (
      <div
        className={`bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 ${className}`}
      >
        <p className="text-red-800 dark:text-red-300">
          ガントチャートの読み込みに失敗しました: {error.message}
        </p>
      </div>
    );
  }

  // データなし状態
  if (!ganttData || ganttData.tasks.length === 0) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <p className="text-gray-500 dark:text-gray-400">
          表示するタスクがありません。タスクを作成するか、フィルター条件を変更してください。
        </p>
      </div>
    );
  }

  // タスクバーデータの生成
  const bars = ganttData.tasks.map((task, index) =>
    taskToBar(task, index, viewport),
  );

  // グリッド線の計算
  const gridLines =
    zoomLevel === 'day'
      ? getDayGridLines(viewport)
      : getWeekGridLines(viewport);

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 ${className}`}
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            ガントチャート
          </h2>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {ganttData.metadata.totalTasks} タスク
            {ganttData.criticalPath.length > 0 && (
              <span className="ml-2 text-red-600 dark:text-red-400">
                • クリティカルパス: {ganttData.criticalPath.length} タスク
              </span>
            )}
          </div>
        </div>

        {/* コントロール */}
        <div className="flex items-center space-x-3">
          {/* 日付ナビゲーション */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => navigateDate('prev')}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title="前の期間"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[120px] text-center">
              {viewDate.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
              })}
            </span>
            <button
              onClick={() => navigateDate('next')}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title="次の期間"
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
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                } first:rounded-l-md last:rounded-r-md`}
              >
                {level === 'day' ? '日' : level === 'week' ? '週' : '月'}
              </button>
            ))}
          </div>

          {/* リセット */}
          <button
            onClick={() => setViewDate(new Date())}
            className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            今日
          </button>
        </div>
      </div>

      {/* ガントチャート */}
      <div
        ref={containerRef}
        className="w-full overflow-auto"
        style={{ height: '500px' }}
      >
        <svg width={viewport.width} height={viewport.height} className="w-full">
          {/* 背景グリッド */}
          <g className="grid-lines">
            {gridLines.map((x, index) => (
              <line
                key={index}
                x1={x}
                y1={viewport.margin.top}
                x2={x}
                y2={viewport.height - viewport.margin.bottom}
                stroke="#E5E7EB"
                strokeWidth="1"
                opacity="0.3"
              />
            ))}
          </g>

          {/* タスク名エリア（左側） */}
          <g className="task-labels">
            {ganttData.tasks.map((task, index) => (
              <g key={task.id}>
                <rect
                  x="0"
                  y={viewport.margin.top + index * viewport.rowHeight}
                  width={viewport.margin.left - 10}
                  height={viewport.rowHeight}
                  fill="transparent"
                />
                <text
                  x={viewport.margin.left - 15}
                  y={
                    viewport.margin.top +
                    index * viewport.rowHeight +
                    viewport.rowHeight / 2 +
                    4
                  }
                  textAnchor="end"
                  fontSize="12"
                  fill="currentColor"
                  className="text-gray-700 dark:text-gray-300"
                >
                  <tspan>
                    {task.title.length > 25
                      ? `${task.title.slice(0, 22)}...`
                      : task.title}
                  </tspan>
                </text>
              </g>
            ))}
          </g>

          {/* タスクバー */}
          <g className="task-bars">
            {bars.map((bar) => (
              <GanttBar
                key={bar.taskId}
                bar={bar}
                isOnCriticalPath={ganttData.criticalPath.includes(bar.taskId)}
                onClick={handleTaskClick}
                onHover={setHoveredTaskId}
              />
            ))}
          </g>

          {/* 依存関係の矢印 */}
          <GanttArrows
            bars={bars}
            dependencies={ganttData.dependencies}
            criticalPath={ganttData.criticalPath}
            hoveredTaskId={hoveredTaskId}
          />
        </svg>
      </div>
    </div>
  );
}
