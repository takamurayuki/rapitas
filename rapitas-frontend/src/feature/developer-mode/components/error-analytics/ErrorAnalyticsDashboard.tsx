'use client';
/**
 * ErrorAnalyticsDashboard
 *
 * Fetches categorised error analytics from the backend and distributes data to
 * child components. Shows a loading spinner while fetching and an error banner
 * on failure.
 */

import React from 'react';
import { RefreshCw, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { useErrorAnalytics } from '../../hooks/useErrorAnalytics';
import { ErrorCategoryBreakdown } from './ErrorCategoryBreakdown';
import { ErrorWeeklyComparison } from './ErrorWeeklyComparison';
import { ErrorTopMessages } from './ErrorTopMessages';

interface SummaryCardProps {
  label: string;
  value: string | number;
  sub?: string;
}

/** Single metric card used in the top summary row. */
function SummaryCard({ label, value, sub }: SummaryCardProps) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-4">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{value}</p>
      {sub && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  );
}

interface Props {
  /** Number of days to include in analytics (default 14). */
  days?: number;
}

/**
 * Main dashboard container for the error analytics page.
 *
 * @param props - See Props
 */
export function ErrorAnalyticsDashboard({ days = 14 }: Props) {
  const { data, loading, error, refresh } = useErrorAnalytics(days);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-3 text-red-700 dark:text-red-300">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <div>
          <p className="font-medium">データの取得に失敗しました</p>
          <p className="text-sm mt-0.5">{error}</p>
        </div>
        <button
          onClick={refresh}
          className="ml-auto text-sm underline hover:no-underline"
        >
          再試行
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { total, categories, availableDays, unclassified } = data;

  const topCategory = categories.find((c) => c.totalCount > 0);

  // Delta display helper
  const formatDelta = (delta: number | null): string => {
    if (delta === null) return '—';
    if (delta === 0) return '変化なし';
    return delta > 0 ? `+${delta}%` : `${delta}%`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          過去 {availableDays} 日分のログを集計
          {unclassified > 0 && (
            <span className="ml-2 text-zinc-400">（未分類 {unclassified} 件を除く）</span>
          )}
        </p>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          aria-label="データを更新"
        >
          <RefreshCw className="w-4 h-4" />
          更新
        </button>
      </div>

      {/* No data state */}
      {availableDays === 0 && (
        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-300">
          <CheckCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm">
            ログデータがありません。バックエンドが起動すると自動的に蓄積されます。
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="合計エラー（集計期間）"
          value={total.count.toLocaleString()}
          sub={`${days}日間`}
        />
        <SummaryCard
          label="今週"
          value={total.currentWeek.toLocaleString()}
          sub="過去7日間"
        />
        <SummaryCard
          label="先週"
          value={total.previousWeek.toLocaleString()}
          sub="7〜14日前"
        />
        <SummaryCard
          label="先週比"
          value={formatDelta(total.deltaPercent)}
          sub={
            total.deltaCount === 0
              ? undefined
              : total.deltaCount > 0
              ? `${total.deltaCount} 件増加`
              : `${Math.abs(total.deltaCount)} 件減少`
          }
        />
      </div>

      {/* Most common category callout */}
      {topCategory && (
        <div className="p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl">
          <p className="text-sm text-violet-700 dark:text-violet-300">
            <span className="font-semibold">最多カテゴリ:</span>{' '}
            {topCategory.label}{' '}
            <span className="font-bold">{topCategory.totalCount}</span> 件（全体の{' '}
            <span className="font-bold">{topCategory.sharePercent}%</span>）
          </p>
        </div>
      )}

      {/* Category breakdown table */}
      <ErrorCategoryBreakdown categories={categories} />

      {/* Two-column: weekly comparison + top messages */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ErrorWeeklyComparison categories={categories} />
        <ErrorTopMessages categories={categories} />
      </div>
    </div>
  );
}
