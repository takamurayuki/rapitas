'use client';
/**
 * ErrorTopMessages
 *
 * Category selector + ranked list of the most frequent error messages for the
 * selected category. Used on the error analytics dashboard.
 */

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CategoryStats } from '../../hooks/useErrorAnalytics';

interface Props {
  /** Sorted category stats from the analytics API. */
  categories: CategoryStats[];
}

/**
 * Shows top error messages per selected category.
 *
 * @param props - See Props
 */
export function ErrorTopMessages({ categories }: Props) {
  const activeCategories = categories.filter((c) => c.totalCount > 0);
  const [selected, setSelected] = useState<string>(activeCategories[0]?.name ?? '');

  const current = activeCategories.find((c) => c.name === selected);

  return (
    <Card className="p-5 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-base font-semibold">頻出エラーメッセージ</h3>

        {activeCategories.length > 0 && (
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="text-sm px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
          >
            {activeCategories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {!current || current.topMessages.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {activeCategories.length === 0
            ? '集計期間内にエラーはありませんでした。'
            : 'このカテゴリのメッセージデータがありません。'}
        </p>
      ) : (
        <ol className="space-y-2">
          {current.topMessages.map(({ msg, count }, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-bold">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-zinc-700 dark:text-zinc-300 break-all leading-relaxed">
                  {msg}
                </p>
              </div>
              <Badge variant="default" className="shrink-0">
                {count}回
              </Badge>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
