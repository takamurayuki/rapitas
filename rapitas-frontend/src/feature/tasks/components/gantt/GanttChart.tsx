/**
 * GanttChart - SVG Gantt chart renderer with drag-to-pan and hover tooltips.
 *
 * Owns: SVG rendering, timeline axis, task row labels (via foreignObject),
 * drag-pan state, and tooltip. Does NOT own: data fetching, zoom/nav controls,
 * or the task detail panel.
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { GanttData } from '@/types/task.types';
import { GanttBar } from './GanttBar';
import {
  taskToBar,
  getWeekGridLines,
  getDayGridLines,
  getTimelineLabels,
  dateToX,
  type GanttViewport,
} from './gantt-utils';

type ZoomLevel = 'day' | 'week' | 'month';

export interface GanttChartProps {
  ganttData: GanttData;
  viewport: GanttViewport;
  zoomLevel: ZoomLevel;
  viewDate: Date;
  onViewDateChange: (date: Date) => void;
  onTaskClick: (taskId: number) => void;
  onResize: (width: number, height: number) => void;
}

/**
 * Renders the Gantt SVG canvas with drag-to-pan support and hover tooltips.
 *
 * @param ganttData - Task and metadata payload from the API / GanttView
 * @param viewport - Pre-computed coordinate system (date range, pixel dimensions, margins)
 * @param zoomLevel - Controls grid line density and secondary label granularity
 * @param viewDate - Current centre date; updated when the user drags to pan
 * @param onViewDateChange - Callback to update viewDate in the parent / GanttView
 * @param onTaskClick - Fires when a bar is clicked without a concurrent drag
 * @param onResize - Fires when the container changes size so GanttView can recompute the viewport
 */
export function GanttChart({
  ganttData,
  viewport,
  zoomLevel,
  viewDate,
  onViewDateChange,
  onTaskClick,
  onResize,
}: GanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // NOTE: Refs (not state) for drag tracking — avoid triggering re-renders on
  // every mousemove and suppress the bar onClick that fires on mouseup after a drag.
  const dragStartRef = useRef<{ clientX: number; viewDate: Date } | null>(null);
  const isDragMoved = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let rafId: number;
    // NOTE: RAF defers setState to the next frame, preventing "ResizeObserver loop
    // completed with undelivered notifications" when setState triggers a re-render
    // that changes layout before all notifications are delivered.
    const observer = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const { width, height } = entries[0].contentRect;
        onResize(width, height);
      });
    });
    observer.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [onResize]);

  const bars = ganttData.tasks.map((task, index) => taskToBar(task, index, viewport));
  const gridLines = zoomLevel === 'day' ? getDayGridLines(viewport) : getWeekGridLines(viewport);
  const timelineLabels = getTimelineLabels(viewport, zoomLevel);
  const primaryLabels = timelineLabels.filter((l) => l.level === 'primary');
  const secondaryLabels = timelineLabels.filter((l) => l.level === 'secondary');

  const today = new Date();
  const todayX =
    today >= viewport.startDate && today <= viewport.endDate ? dateToX(today, viewport) : null;

  const hoveredTask =
    hoveredTaskId !== null ? (ganttData.tasks.find((t) => t.id === hoveredTaskId) ?? null) : null;

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    dragStartRef.current = { clientX: e.clientX, viewDate: new Date(viewDate) };
    isDragMoved.current = false;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (hoveredTaskId !== null) {
      setTooltipPos({ x: e.clientX, y: e.clientY });
    }
    if (!dragStartRef.current) return;

    const deltaX = e.clientX - dragStartRef.current.clientX;
    if (Math.abs(deltaX) < 4) return; // dead zone prevents accidental pans on click

    isDragMoved.current = true;

    const chartWidth = viewport.width - viewport.margin.left - viewport.margin.right;
    const totalMs = viewport.endDate.getTime() - viewport.startDate.getTime();
    if (totalMs <= 0 || chartWidth <= 0) return;

    // Drag right → past (negative delta), drag left → future (positive delta)
    const newDate = new Date(
      dragStartRef.current.viewDate.getTime() - (deltaX / chartWidth) * totalMs,
    );
    onViewDateChange(newDate);
  };

  const handleMouseUp = () => {
    dragStartRef.current = null;
    setIsDragging(false);
  };

  const handleBarClick = useCallback(
    (taskId: number) => {
      // Suppress the click that fires on mouseup at the end of a pan gesture
      if (!isDragMoved.current) onTaskClick(taskId);
    },
    [onTaskClick],
  );

  const svgCursor = isDragging ? 'grabbing' : hoveredTaskId !== null ? 'pointer' : 'grab';

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-y-auto overflow-x-hidden"
      style={{ maxHeight: 'calc(100vh - 320px)', minHeight: '400px' }}
      onMouseLeave={() => {
        setHoveredTaskId(null);
        setTooltipPos(null);
        dragStartRef.current = null;
        setIsDragging(false);
      }}
    >
      <svg
        width={viewport.width}
        height={viewport.height}
        className="w-full min-w-[600px]"
        style={{ cursor: svgCursor, userSelect: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* ヘッダー背景 */}
        <rect
          x={viewport.margin.left}
          y={0}
          width={Math.max(0, viewport.width - viewport.margin.left - viewport.margin.right)}
          height={viewport.margin.top}
          fill="transparent"
        />

        {/* タイムライン軸ラベル — 上段 (月/年) */}
        <g className="timeline-primary">
          {primaryLabels.map((label, i) => (
            <g key={`p-${i}`}>
              <line
                x1={Math.max(label.x, viewport.margin.left)}
                y1={0}
                x2={Math.max(label.x, viewport.margin.left)}
                y2={viewport.margin.top}
                stroke="#D1D5DB"
                strokeWidth="1"
              />
              <text
                x={Math.max(label.x + 4, viewport.margin.left + 4)}
                y={18}
                fontSize="11"
                fontWeight="600"
                fill="currentColor"
                className="text-gray-700 dark:text-gray-200 pointer-events-none select-none"
              >
                {label.label}
              </text>
            </g>
          ))}
        </g>

        {/* タイムライン軸ラベル — 下段 (週/日) */}
        <g className="timeline-secondary">
          {secondaryLabels.map((label, i) => (
            <g key={`s-${i}`}>
              <line
                x1={label.x}
                y1={viewport.margin.top - 22}
                x2={label.x}
                y2={viewport.margin.top}
                stroke="#E5E7EB"
                strokeWidth="1"
              />
              <text
                x={label.x + 3}
                y={viewport.margin.top - 6}
                fontSize="10"
                fill="currentColor"
                className="text-gray-500 dark:text-gray-400 pointer-events-none select-none"
              >
                {label.label}
              </text>
            </g>
          ))}
        </g>

        {/* ヘッダー区切り線 */}
        <line
          x1={0}
          y1={viewport.margin.top}
          x2={viewport.width}
          y2={viewport.margin.top}
          stroke="#E5E7EB"
          strokeWidth="1"
        />

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
              opacity="0.4"
            />
          ))}
        </g>

        {/* 偶数行の背景 */}
        <g className="row-backgrounds">
          {ganttData.tasks.map((_, index) =>
            index % 2 === 1 ? (
              <rect
                key={index}
                x={viewport.margin.left}
                y={viewport.margin.top + index * viewport.rowHeight}
                width={Math.max(0, viewport.width - viewport.margin.left - viewport.margin.right)}
                height={viewport.rowHeight}
                fill="#F9FAFB"
                fillOpacity="0.5"
                className="dark:fill-gray-800"
              />
            ) : null,
          )}
        </g>

        {/* 今日の縦線 — テキストはヘッダーと重なるため三角マーカーのみ */}
        {todayX !== null && (
          <g className="today-line">
            <line
              x1={todayX}
              y1={0}
              x2={todayX}
              y2={viewport.height - viewport.margin.bottom}
              stroke="#EF4444"
              strokeWidth="1.5"
              strokeDasharray="4,3"
              opacity="0.5"
            />
            <polygon
              points={`${todayX - 5},0 ${todayX + 5},0 ${todayX},8`}
              fill="#EF4444"
              opacity="0.7"
            />
          </g>
        )}

        {/* タスク名エリア — foreignObject で CSS text-overflow: ellipsis を実現 */}
        <g className="task-labels">
          {ganttData.tasks.map((task, index) => {
            const isHovered = hoveredTaskId === task.id;
            const rowY = viewport.margin.top + index * viewport.rowHeight;
            return (
              <g key={task.id}>
                <rect
                  x="0"
                  y={rowY}
                  width={viewport.margin.left - 10}
                  height={viewport.rowHeight}
                  fill={isHovered ? '#EFF6FF' : 'transparent'}
                  className={isHovered ? 'dark:fill-blue-900/20' : ''}
                />
                <foreignObject
                  x={8}
                  y={rowY}
                  width={viewport.margin.left - 18}
                  height={viewport.rowHeight}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', height: '100%', width: '100%' }}
                  >
                    <span
                      className={`block overflow-hidden whitespace-nowrap text-ellipsis w-full text-xs ${
                        isHovered
                          ? 'font-semibold text-blue-700 dark:text-blue-400'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                      title={task.title}
                    >
                      {task.title}
                    </span>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>

        {/* タスクバー */}
        <g className="task-bars">
          {bars.map((bar) => (
            <GanttBar
              key={bar.taskId}
              bar={bar}
              onClick={handleBarClick}
              onHover={setHoveredTaskId}
            />
          ))}
        </g>
      </svg>

      {/* ホバーツールチップ */}
      {hoveredTask && tooltipPos && (
        <div
          style={{
            position: 'fixed',
            left: tooltipPos.x + 14,
            top: tooltipPos.y - 52,
            zIndex: 50,
            pointerEvents: 'none',
          }}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl p-3 max-w-[240px]"
        >
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5 leading-snug">
            {hoveredTask.title}
          </div>
          <div className="space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
            {hoveredTask.dueDate && (
              <div>期限: {new Date(hoveredTask.dueDate).toLocaleDateString('ja-JP')}</div>
            )}
            {hoveredTask.estimatedHours && <div>見積: {hoveredTask.estimatedHours}h</div>}
            <div>
              <span
                className="inline-block mt-1 px-2 py-0.5 rounded-full text-white text-[10px] font-medium"
                style={{
                  backgroundColor:
                    bars.find((b) => b.taskId === hoveredTask.id)?.color ?? '#6366F1',
                }}
              >
                {hoveredTask.status === 'done'
                  ? '完了'
                  : hoveredTask.status === 'in-progress'
                    ? '進行中'
                    : hoveredTask.status === 'blocked'
                      ? 'ブロック中'
                      : '未着手'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
