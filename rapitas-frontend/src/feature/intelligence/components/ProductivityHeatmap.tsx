'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Activity, Sun, Moon, Clock, X } from 'lucide-react';
import {
  useProductivityHeatmap,
  type HeatmapCellTask,
} from '../hooks/useIntelligence';
import Link from 'next/link';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}`);

function getHeatColor(value: number, max: number): string {
  if (max === 0 || value === 0) return 'bg-zinc-100 dark:bg-zinc-800';
  const ratio = value / max;
  if (ratio < 0.2) return 'bg-indigo-100 dark:bg-indigo-900/30';
  if (ratio < 0.4) return 'bg-indigo-200 dark:bg-indigo-800/40';
  if (ratio < 0.6) return 'bg-indigo-300 dark:bg-indigo-700/50';
  if (ratio < 0.8) return 'bg-indigo-400 dark:bg-indigo-600/60';
  return 'bg-indigo-500 dark:bg-indigo-500/70';
}

export function ProductivityHeatmap() {
  const { data, loading, fetch, fetchCellTasks } = useProductivityHeatmap();
  const [selectedDays, setSelectedDays] = useState(30);
  const [popover, setPopover] = useState<{
    day: number;
    hour: number;
    tasks: HeatmapCellTask[];
    x: number;
    y: number;
  } | null>(null);
  const [loadingPopover, setLoadingPopover] = useState(false);

  useEffect(() => {
    fetch(selectedDays);
  }, [fetch, selectedDays]);

  const handleCellClick = useCallback(
    async (day: number, hour: number, e: React.MouseEvent) => {
      e.preventDefault();
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setLoadingPopover(true);
      const tasks = await fetchCellTasks(day, hour, selectedDays);
      setPopover({
        day,
        hour,
        tasks,
        x: rect.right + 10,
        y: rect.top,
      });
      setLoadingPopover(false);
    },
    [fetchCellTasks, selectedDays],
  );

  const handleClosePopover = useCallback(() => {
    setPopover(null);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popover && !(e.target as Element).closest('.popover-content')) {
        handleClosePopover();
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [popover, handleClosePopover]);

  const maxCompletions = useMemo(() => {
    if (!data) return 0;
    return Math.max(...data.heatmap.map((c) => c.completions), 1);
  }, [data]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="h-48 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 relative">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-500" />
          生産性ヒートマップ
        </h2>

        {/* Period Filter Tabs */}
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-700 rounded-lg p-1">
          {[30, 60, 90].map((days) => (
            <button
              key={days}
              onClick={() => setSelectedDays(days)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                selectedDays === days
                  ? 'bg-white dark:bg-zinc-600 text-zinc-800 dark:text-zinc-200 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              {days}日
            </button>
          ))}
        </div>
      </div>

      {/* Peak / Low hours summary */}
      <div className="flex items-center gap-4 mb-3 text-xs">
        {data.peakHours.length > 0 && (
          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
            <Sun className="w-3.5 h-3.5" />
            <span>
              ピーク: {data.peakHours.map((h) => `${h}時`).join(', ')}
            </span>
          </div>
        )}
        {data.lowHours.length > 0 && (
          <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500">
            <Moon className="w-3.5 h-3.5" />
            <span>低調: {data.lowHours.map((h) => `${h}時`).join(', ')}</span>
          </div>
        )}
      </div>

      {/* Heatmap grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Hour labels */}
          <div className="flex ml-8 mb-1">
            {HOUR_LABELS.map((h, i) => (
              <div
                key={i}
                className="flex-1 text-center text-[9px] text-zinc-400 dark:text-zinc-500"
              >
                {i % 3 === 0 ? h : ''}
              </div>
            ))}
          </div>

          {/* Grid rows */}
          {DAY_LABELS.map((dayLabel, dayIndex) => (
            <div key={dayIndex} className="flex items-center gap-1 mb-0.5">
              <div className="w-7 text-right text-[10px] text-zinc-500 dark:text-zinc-400 shrink-0">
                {dayLabel}
              </div>
              <div className="flex flex-1 gap-0.5">
                {HOUR_LABELS.map((_, hourIndex) => {
                  const cell = data.heatmap.find(
                    (c) => c.day === dayIndex && c.hour === hourIndex,
                  );
                  const completions = cell?.completions || 0;
                  return (
                    <div
                      key={hourIndex}
                      className={`flex-1 h-5 rounded-sm cursor-pointer ${getHeatColor(completions, maxCompletions)} hover:ring-2 hover:ring-indigo-300 dark:hover:ring-indigo-500 transition-all`}
                      title={`${dayLabel} ${hourIndex}時: ${completions}件完了 (クリックで詳細)`}
                      onClick={(e) => handleCellClick(dayIndex, hourIndex, e)}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
            <span>少</span>
            <div className="w-3 h-3 rounded-sm bg-zinc-100 dark:bg-zinc-800" />
            <div className="w-3 h-3 rounded-sm bg-indigo-200 dark:bg-indigo-800/40" />
            <div className="w-3 h-3 rounded-sm bg-indigo-300 dark:bg-indigo-700/50" />
            <div className="w-3 h-3 rounded-sm bg-indigo-400 dark:bg-indigo-600/60" />
            <div className="w-3 h-3 rounded-sm bg-indigo-500 dark:bg-indigo-500/70" />
            <span>多</span>
          </div>
        </div>
      </div>

      {/* Popover */}
      {(popover || loadingPopover) && (
        <div
          className="fixed z-50 popover-content"
          style={{
            left: `${popover?.x || 0}px`,
            top: `${popover?.y || 0}px`,
            transform: 'translateY(-50%)',
          }}
        >
          <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-4 w-80 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-500" />
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {popover &&
                    `${DAY_LABELS[popover.day]} ${popover.hour}時の完了タスク`}
                </span>
              </div>
              <button
                onClick={handleClosePopover}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingPopover ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-12 bg-zinc-200 dark:bg-zinc-700 rounded"
                  />
                ))}
              </div>
            ) : popover && popover.tasks.length > 0 ? (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {popover.tasks.map((task, index) => (
                  <Link
                    key={index}
                    href={`/tasks/${task.taskId}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                        {task.title}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        完了:{' '}
                        {new Date(task.completedAt).toLocaleTimeString(
                          'ja-JP',
                          {
                            hour: '2-digit',
                            minute: '2-digit',
                          },
                        )}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                この時間帯に完了したタスクはありません
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
