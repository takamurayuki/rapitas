'use client';
// WeeklyReviewCard
import { useMemo } from 'react';
import {
  Sparkles,
  RefreshCw,
  Loader2,
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { useWeeklyReview } from './useWeeklyReview';
import type { WeeklyReviewStats } from '@/types/weekly-review.types';

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};

const formatMinutes = (m: number): string => {
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}時間` : `${h}時間${r}分`;
};

export function WeeklyReviewCard() {
  const {
    review,
    isLoading,
    error,
    isRegenerating,
    regenerateError,
    regenerate,
  } = useWeeklyReview();

  // Decode the stats JSON for display. Falls back to null on parse failure.
  const stats: WeeklyReviewStats | null = useMemo(() => {
    if (!review?.stats) return null;
    try {
      return JSON.parse(review.stats) as WeeklyReviewStats;
    } catch {
      return null;
    }
  }, [review?.stats]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            AI 週次レビュー
          </h2>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-20 rounded bg-zinc-200 dark:bg-zinc-700" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/30">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">週次レビューの読み込みに失敗しました</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            AI 週次レビュー
          </h2>
        </div>
        <button
          type="button"
          onClick={() => regenerate()}
          disabled={isRegenerating}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          title="最新の活動データから再生成します"
        >
          {isRegenerating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {review ? '再生成' : '生成'}
        </button>
      </div>

      {regenerateError && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {regenerateError}
        </div>
      )}

      {!review ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          まだレビューがありません。「生成」ボタンで先週のレビューを作成できます。
        </p>
      ) : (
        <div className="space-y-4">
          {/* Period */}
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Calendar className="h-3 w-3" />
            <span>
              {formatDate(review.weekStart)} 〜 {formatDate(review.weekEnd)}
            </span>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <span>{review.modelUsed}</span>
          </div>

          {/* Stats summary */}
          {stats && (
            <div className="flex flex-wrap gap-4 text-sm text-zinc-700 dark:text-zinc-300">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span>完了 {stats.totalCompletedCount} 件</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-blue-500" />
                <span>集中 {formatMinutes(stats.totalFocusMinutes)}</span>
              </div>
              {stats.pomodoroSessions > 0 && (
                <div className="text-zinc-500 dark:text-zinc-400">
                  ポモドーロ {stats.pomodoroSessions} 回
                </div>
              )}
            </div>
          )}

          {/* Narrative */}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
            {review.summary}
          </p>
        </div>
      )}
    </div>
  );
}
