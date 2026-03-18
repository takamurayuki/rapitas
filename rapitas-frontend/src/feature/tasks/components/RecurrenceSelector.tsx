'use client';

import { useState, useEffect, useCallback } from 'react';
import { Repeat, Calendar, ChevronDown, X, Check } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RecurrenceSelector');

/**
 * Recurrence preset definition.
 */
interface RecurrencePreset {
  key: string;
  rule: string;
  label: string;
}

/**
 * Props for RecurrenceSelector component.
 */
interface RecurrenceSelectorProps {
  taskId: number;
  isRecurring: boolean;
  recurrenceRule: string | null;
  recurrenceEndAt: string | null;
  onUpdate: () => void;
  onClose?: () => void; // Callback to close the accordion (for inline mode)
  className?: string;
  inline?: boolean; // If true, always show expanded (for accordion usage)
}

/**
 * Days of the week for custom selection.
 */
const WEEKDAYS = [
  { key: 'MO', label: '月' },
  { key: 'TU', label: '火' },
  { key: 'WE', label: '水' },
  { key: 'TH', label: '木' },
  { key: 'FR', label: '金' },
  { key: 'SA', label: '土' },
  { key: 'SU', label: '日' },
];

/**
 * Build a custom RRULE string from UI selections.
 */
function buildCustomRule(
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  interval: number,
  selectedDays: string[],
): string {
  let rule = `FREQ=${freq};INTERVAL=${interval}`;
  if (freq === 'WEEKLY' && selectedDays.length > 0) {
    rule += `;BYDAY=${selectedDays.join(',')}`;
  }
  return rule;
}

/**
 * Parse an RRULE string to get human-readable description.
 */
function describeRule(rule: string | null): string {
  if (!rule) return '繰り返しなし';

  const parts = rule.split(';');
  const freq = parts.find((p) => p.startsWith('FREQ='))?.split('=')[1];
  const interval = parseInt(
    parts.find((p) => p.startsWith('INTERVAL='))?.split('=')[1] || '1',
  );
  const byday = parts.find((p) => p.startsWith('BYDAY='))?.split('=')[1];

  const intervalText = interval > 1 ? `${interval}` : '';

  switch (freq) {
    case 'DAILY':
      return interval > 1 ? `${interval}日ごと` : '毎日';
    case 'WEEKLY':
      if (byday) {
        const days = byday.split(',');
        if (
          days.length === 5 &&
          ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => days.includes(d))
        ) {
          return '平日';
        }
        const dayLabels = days
          .map((d) => WEEKDAYS.find((w) => w.key === d)?.label)
          .filter(Boolean);
        return interval > 1
          ? `${interval}週ごと (${dayLabels.join(', ')})`
          : `毎週 ${dayLabels.join(', ')}`;
      }
      return interval > 1 ? `${interval}週ごと` : '毎週';
    case 'MONTHLY':
      return interval > 1 ? `${interval}ヶ月ごと` : '毎月';
    case 'YEARLY':
      return interval > 1 ? `${interval}年ごと` : '毎年';
    default:
      return rule;
  }
}

/**
 * RecurrenceSelector component for setting task recurrence.
 */
export default function RecurrenceSelector({
  taskId,
  isRecurring,
  recurrenceRule,
  recurrenceEndAt,
  onUpdate,
  onClose,
  className = '',
  inline = false,
}: RecurrenceSelectorProps) {
  const [isOpen, setIsOpen] = useState(inline); // Auto-open in inline mode
  const [presets, setPresets] = useState<RecurrencePreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCustom, setShowCustom] = useState(false);

  // Custom rule state
  const [customFreq, setCustomFreq] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>(
    'WEEKLY',
  );
  const [customInterval, setCustomInterval] = useState(1);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [endDate, setEndDate] = useState<string>('');
  const [recurrenceTime, setRecurrenceTime] = useState<string>('00:00');
  const [inheritWorkflowFiles, setInheritWorkflowFiles] =
    useState<boolean>(true);

  // Preview state
  const [previewDates, setPreviewDates] = useState<string[]>([]);

  // Fetch presets on mount
  useEffect(() => {
    const fetchPresets = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/recurrence/presets`);
        if (res.ok) {
          const data = await res.json();
          setPresets(data.presets || []);
        }
      } catch (e) {
        logger.error('Failed to fetch presets:', e);
      }
    };
    fetchPresets();
  }, []);

  // Fetch preview when custom settings change
  useEffect(() => {
    if (!showCustom) return;

    const rule = buildCustomRule(customFreq, customInterval, selectedDays);
    const fetchPreview = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/recurrence/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recurrenceRule: rule,
            recurrenceEndAt: endDate || null,
            limit: 5,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setPreviewDates(data.occurrences || []);
        }
      } catch (e) {
        logger.error('Failed to fetch preview:', e);
      }
    };

    const debounce = setTimeout(fetchPreview, 300);
    return () => clearTimeout(debounce);
  }, [showCustom, customFreq, customInterval, selectedDays, endDate]);

  /**
   * Apply a preset or custom recurrence rule.
   */
  const applyRecurrence = useCallback(
    async (
      rule: string,
      end?: string | null,
      time?: string,
      inheritFiles?: boolean,
    ) => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/recurrence`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recurrenceRule: rule,
            recurrenceEndAt: end || null,
            recurrenceTime: time || '00:00',
            inheritWorkflowFiles: inheritFiles ?? true,
          }),
        });

        if (res.ok) {
          onUpdate();
          setIsOpen(false);
          setShowCustom(false);
          // Close accordion in inline mode
          if (inline && onClose) {
            onClose();
          }
        } else {
          const err = await res.json();
          logger.error('Failed to set recurrence:', err);
        }
      } catch (e) {
        logger.error('Failed to set recurrence:', e);
      } finally {
        setLoading(false);
      }
    },
    [taskId, onUpdate],
  );

  /**
   * Remove recurrence from task.
   */
  const removeRecurrence = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/recurrence`, {
        method: 'DELETE',
      });

      if (res.ok) {
        onUpdate();
        setIsOpen(false);
        // Close accordion in inline mode
        if (inline && onClose) {
          onClose();
        }
      }
    } catch (e) {
      logger.error('Failed to remove recurrence:', e);
    } finally {
      setLoading(false);
    }
  }, [taskId, onUpdate, inline, onClose]);

  /**
   * Toggle a weekday selection.
   */
  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  /**
   * Apply custom rule.
   */
  const applyCustomRule = () => {
    const rule = buildCustomRule(customFreq, customInterval, selectedDays);
    applyRecurrence(
      rule,
      endDate || null,
      recurrenceTime,
      inheritWorkflowFiles,
    );
  };

  return (
    <div className={`relative ${className}`}>
      {/* Trigger button (hidden in inline mode) */}
      {!inline && (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg transition-colors ${
            isRecurring
              ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          }`}
        >
          <Repeat size={14} />
          <span>{isRecurring ? describeRule(recurrenceRule) : '繰り返し'}</span>
          <ChevronDown size={14} className={isOpen ? 'rotate-180' : ''} />
        </button>
      )}

      {/* Dropdown (positioned absolutely in dropdown mode, inline in inline mode) */}
      {isOpen && (
        <div
          className={`${
            inline ? 'w-full' : 'absolute z-50 mt-1 w-72 shadow-lg'
          } bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden max-h-[70vh] overflow-y-auto`}
        >
          {/* Preset options */}
          {!showCustom && (
            <div className="p-2">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 px-2 py-1">
                プリセット
              </div>
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => applyRecurrence(preset.rule)}
                  disabled={loading}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                >
                  <span>{preset.label}</span>
                  {recurrenceRule === preset.rule && (
                    <Check size={14} className="text-indigo-500" />
                  )}
                </button>
              ))}

              <div className="border-t border-zinc-200 dark:border-zinc-700 my-2" />

              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                <Calendar size={14} />
                <span>カスタム...</span>
              </button>

              {isRecurring && (
                <>
                  <div className="border-t border-zinc-200 dark:border-zinc-700 my-2" />
                  <button
                    type="button"
                    onClick={removeRecurrence}
                    disabled={loading}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <X size={14} />
                    <span>繰り返しを解除</span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* Custom settings */}
          {showCustom && (
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">カスタム設定</span>
                <button
                  type="button"
                  onClick={() => setShowCustom(false)}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Frequency */}
              <div>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  頻度
                </label>
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
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  間隔
                </label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={customInterval}
                    onChange={(e) =>
                      setCustomInterval(
                        Math.max(1, parseInt(e.target.value) || 1),
                      )
                    }
                    className="w-16 px-2 py-1 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                  />
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {customFreq === 'DAILY'
                      ? '日ごと'
                      : customFreq === 'WEEKLY'
                        ? '週ごと'
                        : 'ヶ月ごと'}
                  </span>
                </div>
              </div>

              {/* Weekdays (only for WEEKLY) */}
              {customFreq === 'WEEKLY' && (
                <div>
                  <label className="text-xs text-zinc-500 dark:text-zinc-400">
                    曜日
                  </label>
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
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  終了日（任意）
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full mt-1 px-2 py-1 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                />
              </div>

              {/* Execution time */}
              <div>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  実行時刻
                </label>
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
                  <label className="text-xs text-zinc-500 dark:text-zinc-400">
                    プレビュー
                  </label>
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
                onClick={applyCustomRule}
                disabled={loading}
                className="w-full py-2 text-sm font-medium bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
              >
                {loading ? '保存中...' : '適用'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
