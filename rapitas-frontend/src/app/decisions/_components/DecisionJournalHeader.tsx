'use client';
import { Scale, Plus, Clock } from 'lucide-react';

interface DecisionJournalHeaderProps {
  totalDecisions: number;
  reviewDueCount: number;
  onAddClick: () => void;
  onReviewClick: () => void;
}

/**
 * Header for the Decision Journal page. Shows a scale icon, decision count,
 * a "New Decision" button, and a "Today's Review" button that opens the
 * review-due queue.
 */
export function DecisionJournalHeader({
  totalDecisions,
  reviewDueCount,
  onAddClick,
  onReviewClick,
}: DecisionJournalHeaderProps) {
  const statusText =
    totalDecisions === 0 ? '意思決定を記録して精度を高める' : `${totalDecisions}件の決定`;

  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/30">
          <Scale className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">意思決定</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{statusText}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {reviewDueCount > 0 && (
          <button
            onClick={onReviewClick}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:bg-amber-950/50"
          >
            <Clock className="h-4 w-4" />
            今日のレビュー
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
              {reviewDueCount}
            </span>
          </button>
        )}
        <button
          onClick={onAddClick}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          決定を記録
        </button>
      </div>
    </div>
  );
}
