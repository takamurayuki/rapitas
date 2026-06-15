'use client';
/**
 * ErrorCategoryBreakdown
 *
 * Table of error categories with count, % share of total, and week-over-week
 * delta. Each row is expandable to show the top 5 most frequent messages for
 * that category.
 */

import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CategoryStats } from '../../hooks/useErrorAnalytics';

interface Props {
  /** Sorted category stats from the analytics API. */
  categories: CategoryStats[];
}

/**
 * Render a coloured delta badge (先週比).
 *
 * @param deltaPercent - % change vs previous week, or null when prev = 0
 * @returns A styled badge element
 */
function DeltaBadge({ deltaPercent }: { deltaPercent: number | null }) {
  if (deltaPercent === null) {
    return (
      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
        new
      </span>
    );
  }
  if (deltaPercent === 0) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-500">変化なし</span>;
  }
  const positive = deltaPercent > 0;
  return (
    <span
      className={`text-xs font-semibold ${
        positive ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
      }`}
    >
      {positive ? '+' : ''}
      {deltaPercent}%
    </span>
  );
}

/**
 * Displays error categories as an expandable table.
 *
 * @param props - See Props
 */
export function ErrorCategoryBreakdown({ categories }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const activeCategories = categories.filter((c) => c.totalCount > 0);

  if (activeCategories.length === 0) {
    return (
      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <h3 className="text-base font-semibold mb-3">カテゴリ別内訳</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          集計期間内にエラーは検出されませんでした。
        </p>
      </Card>
    );
  }

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="px-4 py-3 border-b dark:border-gray-700">
        <h3 className="text-base font-semibold">カテゴリ別内訳</h3>
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {categories.map((cat) => {
          if (cat.totalCount === 0) return null;
          const isOpen = expanded === cat.name;
          return (
            <div key={cat.name}>
              {/* Row */}
              <button
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/40 transition-colors text-left"
                onClick={() => setExpanded(isOpen ? null : cat.name)}
                aria-expanded={isOpen}
              >
                {/* Expand icon */}
                <span className="shrink-0 text-zinc-400">
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </span>

                {/* Category label */}
                <span className="flex-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {cat.label}
                </span>

                {/* % share bar */}
                <div className="hidden sm:flex items-center gap-1 w-28">
                  <div className="flex-1 bg-zinc-100 dark:bg-zinc-700 rounded-full h-1.5">
                    <div
                      className="bg-violet-500 h-1.5 rounded-full"
                      style={{ width: `${cat.sharePercent}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 w-9 text-right">
                    {cat.sharePercent}%
                  </span>
                </div>

                {/* Count */}
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 w-12 text-right">
                  {cat.totalCount}
                </span>

                {/* WoW delta */}
                <span className="w-20 text-right">
                  <DeltaBadge deltaPercent={cat.deltaPercent} />
                </span>
              </button>

              {/* Expanded: top messages */}
              {isOpen && cat.topMessages.length > 0 && (
                <div className="px-10 pb-3 pt-1 space-y-1.5 bg-zinc-50 dark:bg-zinc-900/30">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    頻出メッセージ（上位{cat.topMessages.length}件）
                  </p>
                  {cat.topMessages.map(({ msg, count }, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Badge variant="default" className="shrink-0">
                        {count}回
                      </Badge>
                      <span className="font-mono text-zinc-600 dark:text-zinc-400 break-all">
                        {msg}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Column headers (below content to avoid layout shift before categories render) */}
      <div className="hidden sm:flex px-4 py-1.5 border-t dark:border-gray-700 bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-400 dark:text-zinc-500 gap-3">
        <span className="flex-1">カテゴリ</span>
        <span className="w-28 text-right">シェア</span>
        <span className="w-12 text-right">件数</span>
        <span className="w-20 text-right">先週比</span>
      </div>
    </Card>
  );
}
