/**
 * PaidLeaveDurationPicker
 *
 * Controls for selecting whether the paid leave is all-day, half-day, or multi-day,
 * and renders the appropriate date/time inputs for each mode.
 */

'use client';

import { Clock, CalendarDays } from 'lucide-react';

type PaidLeaveDurationPickerProps = {
  isAllDay: boolean;
  isHalfDay: boolean;
  isMultiDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  onAllDayClick: () => void;
  onHalfDayClick: () => void;
  onMultiDayToggle: () => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onMorningHalfDay: () => void;
  onAfternoonHalfDay: () => void;
};

/**
 * Duration picker section of the PaidLeaveDialog.
 *
 * @param props - See PaidLeaveDurationPickerProps
 * @returns JSX element with toggle buttons and conditional date/time inputs.
 */
export function PaidLeaveDurationPicker({
  isAllDay,
  isHalfDay,
  isMultiDay,
  startDate,
  endDate,
  startTime,
  endTime,
  onAllDayClick,
  onHalfDayClick,
  onMultiDayToggle,
  onStartDateChange,
  onEndDateChange,
  onMorningHalfDay,
  onAfternoonHalfDay,
}: PaidLeaveDurationPickerProps) {
  return (
    <div className="mt-4 space-y-3">
      {/* Duration type toggles */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onAllDayClick}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
            isAllDay && !isHalfDay
              ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
              : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
          }`}
        >
          終日
        </button>
        <button
          type="button"
          onClick={onHalfDayClick}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
            isHalfDay
              ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-300 dark:ring-indigo-700'
              : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          半日
        </button>
        <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-600" />
        <button
          type="button"
          onClick={onMultiDayToggle}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
            isMultiDay
              ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 ring-1 ring-purple-300 dark:ring-purple-700'
              : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
          }`}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          複数日
        </button>
      </div>

      {/* Multi-day date range inputs */}
      {isMultiDay && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">
              開始日
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 text-sm transition-all dark:[&::-webkit-calendar-picker-indicator]:invert"
            />
          </div>
          <div className="w-5 h-px bg-zinc-300 dark:bg-zinc-600 shrink-0 mt-5" />
          <div className="flex-1">
            <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">
              終了日
            </label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => onEndDateChange(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 text-sm transition-all dark:[&::-webkit-calendar-picker-indicator]:invert"
            />
          </div>
        </div>
      )}

      {/* Half-day time selection — only for single day */}
      {isHalfDay && !isMultiDay && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            半日休暇の時間
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onMorningHalfDay}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                startTime === '09:00' && endTime === '13:00'
                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-700'
                  : 'bg-zinc-50 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
              }`}
            >
              午前 (9:00-13:00)
            </button>
            <button
              type="button"
              onClick={onAfternoonHalfDay}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                startTime === '13:00' && endTime === '17:00'
                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-700'
                  : 'bg-zinc-50 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
              }`}
            >
              午後 (13:00-17:00)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
