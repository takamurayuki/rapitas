'use client';
// PaidLeaveHeader

import { X, Coffee } from 'lucide-react';

type PaidLeaveHeaderProps = {
  /** Hex color used for the icon background. */
  color: string;
  /** Formatted start date string for display. */
  formattedStartDate: string;
  /** Formatted end date string, or null when single-day. */
  formattedEndDate: string | null;
  /** Number of calendar days covered by the selection. */
  dayCount: number;
  /** Whether the selected start date falls on a weekend. */
  isWeekend: boolean;
  /** Remaining paid leave days before this request. */
  remainingDays: number;
  /** Days consumed by the current selection. */
  usedDays: number;
  /** Remaining days after applying the current request (may be negative). */
  afterUsage: number;
  onClose: () => void;
};

/**
 * Header section of the PaidLeaveDialog.
 *
 * @param props - See PaidLeaveHeaderProps
 * @returns JSX element rendering the dialog header and balance summary.
 */
export function PaidLeaveHeader({
  color,
  formattedStartDate,
  formattedEndDate,
  dayCount,
  isWeekend,
  remainingDays,
  usedDays,
  afterUsage,
  onClose,
}: PaidLeaveHeaderProps) {
  return (
    <div className="px-5 pt-4 pb-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex flex-col items-center justify-center text-white font-bold shadow-sm"
            style={{ backgroundColor: color }}
          >
            <Coffee className="w-6 h-6" />
          </div>
          <div>
            <p
              className={`text-sm font-semibold ${isWeekend ? 'text-red-500 dark:text-red-400' : 'text-zinc-800 dark:text-zinc-100'}`}
            >
              {formattedStartDate}
            </p>
            {formattedEndDate ? (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                〜 {formattedEndDate}
                <span className="ml-1 text-red-500 dark:text-red-400 font-medium">
                  ({dayCount}日間)
                </span>
              </p>
            ) : (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">有給休暇を申請</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Paid leave balance summary */}
      <div className="mb-3">
        <div
          className={`text-xs p-2 rounded-lg ${
            afterUsage < 0
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
              : afterUsage < 5
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          }`}
        >
          <div className="flex justify-between items-center">
            <span>有給残日数: {remainingDays}日</span>
            <span>使用: {usedDays}日</span>
          </div>
          <div className="flex justify-between items-center mt-1">
            <span className="font-medium">申請後: {afterUsage}日</span>
            {afterUsage < 0 && <span className="text-xs">⚠️ 残日数不足</span>}
          </div>
        </div>
      </div>

      <div className="h-px bg-zinc-200 dark:bg-zinc-700" />
    </div>
  );
}
