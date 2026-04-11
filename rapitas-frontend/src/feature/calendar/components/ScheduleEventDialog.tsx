'use client';

/**
 * ScheduleEventDialog
 *
 * Modal dialog for creating a new calendar schedule event.
 * Responsible for collecting event title, time range, color, and reminder settings
 * and delegating submission to the parent via onSubmit.
 * Not responsible for persisting data directly — see the parent calendar component.
 */

import { useState, useRef, useEffect } from 'react';
import { X, Clock, ChevronDown, CalendarDays } from 'lucide-react';
import type { ScheduleEventInput } from '@/types';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import {
  DEFAULT_EVENT_COLOR,
  DEFAULT_REMINDER_MINUTES,
  QUICK_TIMES,
} from './schedule-constants';
import {
  getDefaultTimes,
  toUTCISO,
  calcDayCount,
  resolveEndAt,
} from './schedule-utils';
import { ScheduleOptionsPanel } from './ScheduleOptionsPanel';

type Props = {
  selectedDate: string;
  onClose: () => void;
  onSubmit: (data: ScheduleEventInput) => Promise<void>;
};

/**
 * ScheduleEventDialog — modal form for adding a new calendar event.
 *
 * @param selectedDate - Pre-selected date "YYYY-MM-DD" / 選択済み日付
 * @param onClose - Callback to dismiss the dialog / ダイアログを閉じるコールバック
 * @param onSubmit - Async callback to persist the event / イベントを保存する非同期コールバック
 */
export default function ScheduleEventDialog({
  selectedDate,
  onClose,
  onSubmit,
}: Props) {
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const defaults = getDefaultTimes();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(selectedDate);
  const [endDate, setEndDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState(defaults.start);
  const [endTime, setEndTime] = useState(defaults.end);
  const [isAllDay, setIsAllDay] = useState(false);
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [color, setColor] = useState(DEFAULT_EVENT_COLOR);
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(
    DEFAULT_REMINDER_MINUTES,
  );
  const [submitting, setSubmitting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const startAt = isAllDay
        ? toUTCISO(startDate)
        : toUTCISO(startDate, startTime);
      const endAt = resolveEndAt(
        startDate,
        endDate,
        startTime,
        endTime,
        isAllDay,
        isMultiDay,
      );
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        startAt,
        endAt,
        isAllDay,
        color,
        reminderMinutes,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const formattedStartDate = new Date(startDate).toLocaleDateString(
    dateLocale,
    {
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    },
  );
  const formattedEndDate =
    isMultiDay && endDate > startDate
      ? new Date(endDate).toLocaleDateString(dateLocale, {
          month: 'long',
          day: 'numeric',
          weekday: 'short',
        })
      : null;
  const isWeekend = [0, 6].includes(new Date(startDate).getDay());
  const dayCount = calcDayCount(startDate, endDate);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-800 sm:rounded-2xl rounded-t-2xl border border-zinc-200 dark:border-zinc-700 shadow-2xl w-full sm:max-w-md animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Color accent bar */}
        <div
          className="h-1.5 sm:rounded-t-2xl rounded-t-2xl transition-colors duration-200"
          style={{ backgroundColor: color }}
        />

        {/* Header */}
        <div className="px-5 pt-4 pb-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl flex flex-col items-center justify-center text-white font-bold shadow-sm"
                style={{ backgroundColor: color }}
              >
                <span className="text-[10px] leading-none opacity-80 uppercase">
                  {new Date(startDate).toLocaleDateString(dateLocale, {
                    month: 'short',
                  })}
                </span>
                <span className="text-lg leading-none font-bold">
                  {new Date(startDate).getDate()}
                </span>
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
                    <span className="ml-1 text-indigo-500 dark:text-indigo-400 font-medium">
                      ({dayCount}日間)
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                    予定を追加
                  </p>
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
          <div className="h-px bg-zinc-200 dark:bg-zinc-700" />
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 pt-4 pb-5">
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="タイトルを入力"
            className="w-full py-3 text-lg font-medium bg-transparent text-zinc-900 dark:text-zinc-50 placeholder-zinc-300 dark:placeholder-zinc-600 focus:outline-none border-b border-zinc-100 dark:border-zinc-700 focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
          />

          {/* Time section */}
          <div className="mt-4 space-y-3">
            {/* All-day / Time toggle + Multi-day toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setIsAllDay(true)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${isAllDay ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'}`}
              >
                終日
              </button>
              <button
                type="button"
                onClick={() => setIsAllDay(false)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${!isAllDay ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'}`}
              >
                <Clock className="w-3.5 h-3.5" />
                時間指定
              </button>
              <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-600" />
              <button
                type="button"
                onClick={() => {
                  setIsMultiDay(!isMultiDay);
                  if (!isMultiDay) setEndDate(startDate);
                }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${isMultiDay ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-300 dark:ring-indigo-700' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'}`}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                複数日
              </button>
            </div>

            {/* Multi-day date range */}
            {isMultiDay && (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">
                    開始日
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (e.target.value > endDate) setEndDate(e.target.value);
                    }}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 text-sm transition-all dark:[&::-webkit-calendar-picker-indicator]:invert"
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
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 text-sm transition-all dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>
              </div>
            )}

            {/* Time inputs */}
            {!isAllDay && (
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  {QUICK_TIMES.map((qt) => (
                    <button
                      key={qt.label}
                      type="button"
                      onClick={() => {
                        setStartTime(qt.start);
                        setEndTime(qt.end);
                      }}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${startTime === qt.start && endTime === qt.end ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-300 dark:ring-indigo-700' : 'bg-zinc-50 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}
                    >
                      {qt.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => {
                      setStartTime(e.target.value);
                      // Auto-adjust end time to 1 hour after start
                      const [h, m] = e.target.value.split(':').map(Number);
                      const endH = (h + 1) % 24; // NOTE: wraps midnight (23:xx → 00:xx)
                      setEndTime(
                        `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
                      );
                    }}
                    className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 text-sm transition-all dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                  <div className="w-5 h-px bg-zinc-300 dark:bg-zinc-600 shrink-0" />
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 text-sm transition-all dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Expandable options toggle */}
          <button
            type="button"
            onClick={() => setShowOptions(!showOptions)}
            className="mt-3 flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${showOptions ? 'rotate-180' : ''}`}
            />
            {showOptions ? 'オプションを閉じる' : 'カラー・リマインド・メモ'}
          </button>

          {showOptions && (
            <ScheduleOptionsPanel
              color={color}
              setColor={setColor}
              reminderMinutes={reminderMinutes}
              setReminderMinutes={setReminderMinutes}
              description={description}
              setDescription={setDescription}
            />
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className={`mt-4 w-full py-3 rounded-xl font-medium text-white transition-all disabled:cursor-not-allowed active:scale-[0.98] ${!title.trim() ? 'bg-zinc-300 dark:bg-zinc-600 opacity-40' : ''}`}
            style={title.trim() ? { backgroundColor: color } : undefined}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                作成中...
              </span>
            ) : (
              '追加する'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
