'use client';

/**
 * RecurrenceCustomForm
 *
 * Sub-form for configuring a custom RRULE within RecurrenceSelector.
 * Responsible for rendering frequency, interval, weekday, end-date, time,
 * and workflow-inheritance controls, plus an occurrence preview list.
 * Not responsible for API persistence — the parent handles that via onApply.
 */

import { X } from 'lucide-react';
import { WEEKDAYS } from './recurrence-utils';

/** Props for RecurrenceCustomForm. */
export interface RecurrenceCustomFormProps {
  customFreq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  setCustomFreq: (f: 'DAILY' | 'WEEKLY' | 'MONTHLY') => void;
  customInterval: number;
  setCustomInterval: (n: number) => void;
  selectedDays: string[];
  toggleDay: (day: string) => void;
  endDate: string;
  setEndDate: (d: string) => void;
  recurrenceTime: string;
  setRecurrenceTime: (t: string) => void;
  inheritWorkflowFiles: boolean;
  setInheritWorkflowFiles: (v: boolean) => void;
  previewDates: string[];
  loading: boolean;
  onApply: () => void;
  onBack: () => void;
}

/**
 * Renders the custom recurrence configuration panel.
 */
export function RecurrenceCustomForm({
  customFreq,
  setCustomFreq,
  customInterval,
  setCustomInterval,
  selectedDays,
  toggleDay,
  endDate,
  setEndDate,
  recurrenceTime,
  setRecurrenceTime,
  inheritWorkflowFiles,
  setInheritWorkflowFiles,
  previewDates,
  loading,
  onApply,
  onBack,
}: RecurrenceCustomFormProps) {
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">カスタム設定</span>
        <button
          type="button"
          onClick={onBack}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <X size={16} />
        </button>
      </div>

      {/* Frequency */}
      <div>
        <label className="text-xs text-zinc-500 dark:text-zinc-400">頻度</label>
        <div className="flex gap-1 mt-1">
          {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setCustomFreq(f)}
              className={`flex-1 px-2 py-1 text-xs rounded-lg transition-colors ${
                customFreq === f
                  ? 'bg-indigo-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {f === 'DAILY' ? '日' : f === 'WEEKLY' ? '週' : '月'}
            </button>
          ))}
        </div>
      </div>

      {/* Interval */}
      <div>
        <label className="text-xs text-zinc-500 dark:text-zinc-400">間隔</label>
        <div className="flex items-center gap-2 mt-1">
          <input
            type="number"
            min={1}
            max={99}
            value={customInterval}
            onChange={(e) => setCustomInterval(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 px-2 py-1 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
          />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {customFreq === 'DAILY' ? '日ごと' : customFreq === 'WEEKLY' ? '週ごと' : 'ヶ月ごと'}
          </span>
        </div>
      </div>

      {/* Weekdays (only for WEEKLY) */}
      {customFreq === 'WEEKLY' && (
        <div>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">曜日</label>
          <div className="flex gap-1 mt-1">
            {WEEKDAYS.map((day) => (
              <button
                key={day.key}
                type="button"
                onClick={() => toggleDay(day.key)}
                className={`w-8 h-8 text-xs rounded-full transition-colors ${
                  selectedDays.includes(day.key)
                    ? 'bg-indigo-500 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* End date */}
      <div>
        <label className="text-xs text-zinc-500 dark:text-zinc-400">終了日（任意）</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-full mt-1 px-2 py-1 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
        />
      </div>

      {/* Execution time */}
      <div>
        <label className="text-xs text-zinc-500 dark:text-zinc-400">実行時刻</label>
        <input
          type="time"
          value={recurrenceTime}
          onChange={(e) => setRecurrenceTime(e.target.value)}
          className="w-full mt-1 px-2 py-1 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
        />
      </div>

      {/* Workflow file inheritance */}
      <div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={inheritWorkflowFiles}
            onChange={(e) => setInheritWorkflowFiles(e.target.checked)}
            className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-indigo-500 focus:ring-indigo-500"
          />
          <span className="text-zinc-600 dark:text-zinc-400">
            前回の実行履歴を継承（research/plan/verify.md）
          </span>
        </label>
      </div>

      {/* Preview */}
      {previewDates.length > 0 && (
        <div>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">プレビュー</label>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 space-y-0.5">
            {previewDates.slice(0, 5).map((date, i) => (
              <div key={i}>
                {new Date(date).toLocaleDateString('ja-JP', {
                  month: 'short',
                  day: 'numeric',
                  weekday: 'short',
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Apply button */}
      <button
        type="button"
        onClick={onApply}
        disabled={loading}
        className="w-full py-2 text-sm font-medium bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
      >
        {loading ? '保存中...' : '適用'}
      </button>
    </div>
  );
}
