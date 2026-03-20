/**
 * PaidLeaveDialog
 *
 * Modal dialog for submitting a paid leave request. Owns all form state and
 * delegates rendering to PaidLeaveHeader, PaidLeaveDurationPicker, and PaidLeaveOptions.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import type { ScheduleEventInput } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';
import { PaidLeaveHeader } from './paid-leave/PaidLeaveHeader';
import { PaidLeaveDurationPicker } from './paid-leave/PaidLeaveDurationPicker';
import { PaidLeaveOptions } from './paid-leave/PaidLeaveOptions';

const PAID_LEAVE_TYPES = [
  { value: 'annual_leave', label: '年次有給休暇' },
  { value: 'special_leave', label: '特別休暇' },
  { value: 'sick_leave', label: '病気休暇' },
  { value: 'personal_leave', label: '私用休暇' },
];

type Props = {
  selectedDate: string;
  onClose: () => void;
  onSubmit: (data: ScheduleEventInput) => Promise<void>;
  remainingDays?: number;
};

/**
 * Returns the default start/end times for a half-day morning leave.
 *
 * @returns Object with `start` and `end` time strings in HH:mm format.
 */
function getDefaultTimes(): { start: string; end: string } {
  return { start: '09:00', end: '13:00' };
}

/**
 * Main paid leave request dialog.
 *
 * @param props - See Props
 * @returns Full-screen modal with the paid leave form.
 */
export default function PaidLeaveDialog({
  selectedDate,
  onClose,
  onSubmit,
  remainingDays = 20,
}: Props) {
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const defaults = getDefaultTimes();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [leaveType, setLeaveType] = useState('annual_leave');
  const [startDate, setStartDate] = useState(selectedDate);
  const [endDate, setEndDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState(defaults.start);
  const [endTime, setEndTime] = useState(defaults.end);
  const [isAllDay, setIsAllDay] = useState(true);
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [color, setColor] = useState('#FF6B6B');
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(1440);
  const [submitting, setSubmitting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Auto-fill title from selected leave type and focus the input
  useEffect(() => {
    titleRef.current?.focus();
    const selectedType = PAID_LEAVE_TYPES.find((t) => t.value === leaveType);
    if (selectedType) setTitle(selectedType.label);
  }, [leaveType]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const calculateUsedDays = () => {
    if (!isMultiDay) return isAllDay ? 1 : 0.5;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = end.getTime() - start.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  const usedDays = calculateUsedDays();
  const afterUsage = remainingDays - usedDays;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      const toUTCISO = (dateStr: string, timeStr: string = '00:00') => {
        const [year, month, day] = dateStr.split('-').map(Number);
        const [hour, min] = timeStr.split(':').map(Number);
        return new Date(Date.UTC(year, month - 1, day, hour, min, 0)).toISOString();
      };

      let startAt: string;
      let endAt: string | undefined;

      if (isAllDay) {
        startAt = toUTCISO(startDate);
        if (isMultiDay && endDate > startDate) {
          // NOTE: All-day events end at 00:00 on the day after the last day.
          const nextDay = new Date(endDate);
          nextDay.setDate(nextDay.getDate() + 1);
          const [year, month, day] = nextDay.toISOString().split('T')[0].split('-').map(Number);
          endAt = new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString();
        }
      } else {
        startAt = toUTCISO(startDate, startTime);
        endAt = isMultiDay && endDate >= startDate
          ? toUTCISO(endDate, endTime)
          : toUTCISO(startDate, endTime);
      }

      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        startAt,
        endAt,
        isAllDay: isAllDay && !isHalfDay,
        color,
        reminderMinutes,
        type: 'PAID_LEAVE',
        userId: 'default',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const formattedStartDate = new Date(startDate).toLocaleDateString(dateLocale, {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  const formattedEndDate =
    isMultiDay && endDate > startDate
      ? new Date(endDate).toLocaleDateString(dateLocale, {
          month: 'long',
          day: 'numeric',
          weekday: 'short',
        })
      : null;

  const dayOfWeek = new Date(startDate).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const dayCount =
    isMultiDay && endDate > startDate
      ? Math.ceil(
          (new Date(endDate).getTime() - new Date(startDate).getTime()) /
            (1000 * 60 * 60 * 24),
        ) + 1
      : 1;

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

        <PaidLeaveHeader
          color={color}
          formattedStartDate={formattedStartDate}
          formattedEndDate={formattedEndDate}
          dayCount={dayCount}
          isWeekend={isWeekend}
          remainingDays={remainingDays}
          usedDays={usedDays}
          afterUsage={afterUsage}
          onClose={onClose}
        />

        <form onSubmit={handleSubmit} className="px-5 pt-4 pb-5">
          {/* Leave type selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              休暇の種類
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PAID_LEAVE_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setLeaveType(type.value)}
                  className={`p-2 rounded-lg text-xs font-medium transition-all ${
                    leaveType === type.value
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                      : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title input — auto-filled but editable */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="タイトルを入力"
            className="w-full py-3 text-lg font-medium bg-transparent text-zinc-900 dark:text-zinc-50 placeholder-zinc-300 dark:placeholder-zinc-600 focus:outline-none border-b border-zinc-100 dark:border-zinc-700 focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
          />

          <PaidLeaveDurationPicker
            isAllDay={isAllDay}
            isHalfDay={isHalfDay}
            isMultiDay={isMultiDay}
            startDate={startDate}
            endDate={endDate}
            startTime={startTime}
            endTime={endTime}
            onAllDayClick={() => { setIsAllDay(true); setIsHalfDay(false); }}
            onHalfDayClick={() => { setIsAllDay(false); setIsHalfDay(true); }}
            onMultiDayToggle={() => {
              setIsMultiDay(!isMultiDay);
              if (!isMultiDay) setEndDate(startDate);
            }}
            onStartDateChange={(val) => {
              setStartDate(val);
              if (val > endDate) setEndDate(val);
            }}
            onEndDateChange={setEndDate}
            onMorningHalfDay={() => { setStartTime('09:00'); setEndTime('13:00'); }}
            onAfternoonHalfDay={() => { setStartTime('13:00'); setEndTime('17:00'); }}
          />

          <PaidLeaveOptions
            showOptions={showOptions}
            onToggleOptions={() => setShowOptions(!showOptions)}
            color={color}
            onColorChange={setColor}
            reminderMinutes={reminderMinutes}
            onReminderChange={setReminderMinutes}
            description={description}
            onDescriptionChange={setDescription}
          />

          {/* Submit button */}
          <button
            type="submit"
            disabled={!title.trim() || submitting || afterUsage < 0}
            className={`mt-4 w-full py-3 rounded-xl font-medium text-white transition-all disabled:cursor-not-allowed active:scale-[0.98] ${
              !title.trim() || afterUsage < 0
                ? 'bg-zinc-300 dark:bg-zinc-600 opacity-40'
                : ''
            }`}
            style={
              title.trim() && afterUsage >= 0
                ? { backgroundColor: color }
                : undefined
            }
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                申請中...
              </span>
            ) : afterUsage < 0 ? (
              '残日数不足'
            ) : (
              `有給申請 (${usedDays}日)`
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
