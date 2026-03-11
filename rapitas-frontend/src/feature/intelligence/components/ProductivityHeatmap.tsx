'use client';

import { useEffect, useMemo } from 'react';
import { Activity, Sun, Moon } from 'lucide-react';
import { useProductivityHeatmap } from '../hooks/useIntelligence';

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
  const { data, loading, fetch } = useProductivityHeatmap();

  useEffect(() => {
    fetch();
  }, [fetch]);

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
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5 text-indigo-500" />
        生産性ヒートマップ
      </h2>

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
                      className={`flex-1 h-5 rounded-sm ${getHeatColor(completions, maxCompletions)} transition-colors`}
                      title={`${dayLabel} ${hourIndex}時: ${completions}件完了`}
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
    </div>
  );
}
