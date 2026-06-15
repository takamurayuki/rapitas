'use client';
/**
 * ErrorWeeklyComparison
 *
 * Side-by-side bar chart comparing this week vs last week per category.
 * Bars are proportional to the category's max weekly count.
 */

import React from 'react';
import { Card } from '@/components/ui/card';
import type { CategoryStats } from '../../hooks/useErrorAnalytics';

interface Props {
  /** Sorted category stats from the analytics API. */
  categories: CategoryStats[];
}

/**
 * Renders a week-over-week bar comparison for each active error category.
 *
 * @param props - See Props
 */
export function ErrorWeeklyComparison({ categories }: Props) {
  const activeCategories = categories.filter(
    (c) => c.currentWeek > 0 || c.previousWeek > 0,
  );

  if (activeCategories.length === 0) {
    return (
      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <h3 className="text-base font-semibold mb-3">今週 vs 先週</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          比較できる週次データがありません。
        </p>
      </Card>
    );
  }

  // Normalise bars relative to the highest single-week count
  const maxWeekly = Math.max(...activeCategories.flatMap((c) => [c.currentWeek, c.previousWeek]));

  return (
    <Card className="p-5 dark:bg-gray-800 dark:border-gray-700">
      <h3 className="text-base font-semibold mb-4">今週 vs 先週</h3>

      <div className="flex gap-4 mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-violet-500" />
          今週
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-zinc-300 dark:bg-zinc-600" />
          先週
        </span>
      </div>

      <div className="space-y-4">
        {activeCategories.map((cat) => {
          const currentPct = maxWeekly === 0 ? 0 : (cat.currentWeek / maxWeekly) * 100;
          const previousPct = maxWeekly === 0 ? 0 : (cat.previousWeek / maxWeekly) * 100;
          const isWorse = cat.currentWeek > cat.previousWeek;

          return (
            <div key={cat.name}>
              <div className="flex justify-between items-center mb-1 text-xs">
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">{cat.label}</span>
                <span
                  className={`font-semibold ${
                    isWorse
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  {cat.currentWeek} 件
                </span>
              </div>

              {/* This week bar */}
              <div className="flex items-center gap-2 mb-0.5">
                <div className="flex-1 bg-zinc-100 dark:bg-zinc-700 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all ${
                      isWorse ? 'bg-red-500' : 'bg-violet-500'
                    }`}
                    style={{ width: `${Math.max(currentPct, 1)}%` }}
                  />
                </div>
                <span className="w-8 text-right text-xs text-zinc-500 dark:text-zinc-400">
                  {cat.currentWeek}
                </span>
              </div>

              {/* Last week bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-zinc-100 dark:bg-zinc-700 rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full bg-zinc-300 dark:bg-zinc-600 transition-all"
                    style={{ width: `${Math.max(previousPct, cat.previousWeek > 0 ? 1 : 0)}%` }}
                  />
                </div>
                <span className="w-8 text-right text-xs text-zinc-500 dark:text-zinc-400">
                  {cat.previousWeek}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
