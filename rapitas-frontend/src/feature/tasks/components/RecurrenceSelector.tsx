'use client';

/**
 * RecurrenceSelector
 *
 * UI component for configuring task recurrence rules.
 * Responsible for preset selection, toggling the custom form, and persisting
 * changes via the recurrence API.
 * Not responsible for RRULE parsing (recurrence-utils.ts) or the custom form
 * UI (RecurrenceCustomForm.tsx).
 */

import { useState, useEffect, useCallback } from 'react';
import { Repeat, Calendar, ChevronDown, X, Check } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { buildCustomRule, describeRule } from './recurrence-utils';
import { RecurrenceCustomForm } from './RecurrenceCustomForm';

const logger = createLogger('RecurrenceSelector');

/** Recurrence preset returned by the presets API endpoint. */
interface RecurrencePreset {
  key: string;
  rule: string;
  label: string;
}

/** Props for RecurrenceSelector component. */
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
 * RecurrenceSelector — trigger button + dropdown for task recurrence settings.
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

  // Fetch occurrence preview with debounce when custom settings change
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
   * Persist a recurrence rule via the API.
   *
   * @param rule - RRULE string / RRULE文字列
   * @param end - Optional end date / 終了日（任意）
   * @param time - Execution time "HH:MM" / 実行時刻
   * @param inheritFiles - Inherit previous workflow files / 前回ファイルを継承するか
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
          if (inline && onClose) onClose();
        } else {
          logger.error('Failed to set recurrence:', await res.json());
        }
      } catch (e) {
        logger.error('Failed to set recurrence:', e);
      } finally {
        setLoading(false);
      }
    },
    [taskId, onUpdate, inline, onClose],
  );

  /** Remove recurrence from the task. */
  const removeRecurrence = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/recurrence`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onUpdate();
        setIsOpen(false);
        if (inline && onClose) onClose();
      }
    } catch (e) {
      logger.error('Failed to remove recurrence:', e);
    } finally {
      setLoading(false);
    }
  }, [taskId, onUpdate, inline, onClose]);

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

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

      {isOpen && (
        <div
          className={`${
            inline ? 'w-full' : 'absolute z-50 mt-1 w-72 shadow-lg'
          } bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden max-h-[70vh] overflow-y-auto`}
        >
          {!showCustom ? (
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
          ) : (
            <RecurrenceCustomForm
              customFreq={customFreq}
              setCustomFreq={setCustomFreq}
              customInterval={customInterval}
              setCustomInterval={setCustomInterval}
              selectedDays={selectedDays}
              toggleDay={toggleDay}
              endDate={endDate}
              setEndDate={setEndDate}
              recurrenceTime={recurrenceTime}
              setRecurrenceTime={setRecurrenceTime}
              inheritWorkflowFiles={inheritWorkflowFiles}
              setInheritWorkflowFiles={setInheritWorkflowFiles}
              previewDates={previewDates}
              loading={loading}
              onApply={applyCustomRule}
              onBack={() => setShowCustom(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
