'use client';
import { useState, useRef, useEffect } from 'react';
import {
  X,
  Clock,
  Bell,
  ChevronDown,
  CalendarDays,
  Coffee,
} from 'lucide-react';
import type { ScheduleEventInput } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';

const REMINDER_OPTIONS = [
  { value: null, label: 'なし' },
  { value: 5, label: '5分前' },
  { value: 10, label: '10分前' },
  { value: 15, label: '15分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
  { value: 1440, label: '1日前' },
];

const COLOR_OPTIONS = [
  { value: '#FF6B6B', label: 'Pink Red' },
  { value: '#4ECDC4', label: 'Teal' },
  { value: '#45B7D1', label: 'Sky Blue' },
  { value: '#96CEB4', label: 'Mint Green' },
  { value: '#FFEAA7', label: 'Light Yellow' },
  { value: '#DDA0DD', label: 'Plum' },
  { value: '#98D8C8', label: 'Seafoam' },
  { value: '#F7DC6F', label: 'Light Gold' },
];

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

// Get smart default times for half-day leave
function getDefaultTimes(): { start: string; end: string } {
  return {
    start: '09:00',
    end: '13:00', // Morning half day
  };
}

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
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(1440); // Default 1 day before
  const [submitting, setSubmitting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    // Auto-generate title based on leave type
    const selectedType = PAID_LEAVE_TYPES.find((t) => t.value === leaveType);
    if (selectedType) {
      setTitle(selectedType.label);
    }
  }, [leaveType]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Calculate used days based on selection
  const calculateUsedDays = () => {
    if (!isMultiDay) {
      return isAllDay ? 1 : 0.5; // Single day: 1 full day or 0.5 half day
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  };

  const usedDays = calculateUsedDays();
  const afterUsage = remainingDays - usedDays;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      // Create UTC ISO strings similar to ScheduleEventDialog
      const toUTCISO = (dateStr: string, timeStr: string = '00:00') => {
        const [year, month, day] = dateStr.split('-').map(Number);
        const [hour, min] = timeStr.split(':').map(Number);
        return new Date(
          Date.UTC(year, month - 1, day, hour, min, 0),
        ).toISOString();
      };

      let startAt: string;
      let endAt: string | undefined;

      if (isAllDay) {
        startAt = toUTCISO(startDate);
        if (isMultiDay && endDate > startDate) {
          // 終日イベントは翌日の00:00で終了
          const nextDay = new Date(endDate);
          nextDay.setDate(nextDay.getDate() + 1);
          const [year, month, day] = nextDay
            .toISOString()
            .split('T')[0]
            .split('-')
            .map(Number);
          endAt = new Date(
            Date.UTC(year, month - 1, day, 0, 0, 0),
          ).toISOString();
        }
      } else {
        startAt = toUTCISO(startDate, startTime);
        if (isMultiDay && endDate >= startDate) {
          endAt = toUTCISO(endDate, endTime);
        } else {
          endAt = toUTCISO(startDate, endTime);
        }
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

        {/* Header - date display with paid leave icon */}
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
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                    有給休暇を申請
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

          {/* Paid leave balance warning */}
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
                {afterUsage < 0 && (
                  <span className="text-xs">⚠️ 残日数不足</span>
                )}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-zinc-200 dark:bg-zinc-700" />
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 pt-4 pb-5">
          {/* Leave Type Selection */}
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

          {/* Title - auto-filled but editable */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="タイトルを入力"
            className="w-full py-3 text-lg font-medium bg-transparent text-zinc-900 dark:text-zinc-50 placeholder-zinc-300 dark:placeholder-zinc-600 focus:outline-none border-b border-zinc-100 dark:border-zinc-700 focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
          />

          {/* Duration selection */}
          <div className="mt-4 space-y-3">
            {/* Duration type toggles */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setIsAllDay(true);
                  setIsHalfDay(false);
                }}
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
                onClick={() => {
                  setIsAllDay(false);
                  setIsHalfDay(true);
                }}
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
                onClick={() => {
                  setIsMultiDay(!isMultiDay);
                  if (!isMultiDay) {
                    setEndDate(startDate);
                  }
                }}
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
                      if (e.target.value > endDate) {
                        setEndDate(e.target.value);
                      }
                    }}
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
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 text-sm transition-all dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>
              </div>
            )}

            {/* Half day time selection */}
            {isHalfDay && !isMultiDay && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  半日休暇の時間
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStartTime('09:00');
                      setEndTime('13:00');
                    }}
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
                    onClick={() => {
                      setStartTime('13:00');
                      setEndTime('17:00');
                    }}
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

          {/* Expandable options: color, reminder, memo */}
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
            <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
              {/* Color picker - inline compact */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-400 dark:text-zinc-500 w-10 shrink-0">
                  カラー
                </span>
                <div className="flex gap-1.5">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setColor(c.value)}
                      title={c.label}
                      className={`w-6 h-6 rounded-full transition-all ${
                        color === c.value
                          ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-800 scale-110'
                          : 'hover:scale-110'
                      }`}
                      style={{
                        backgroundColor: c.value,
                        ...(color === c.value
                          ? { ['--tw-ring-color' as string]: c.value }
                          : {}),
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Reminder - inline */}
              <div className="flex items-center gap-3">
                <Bell className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0 ml-0.5" />
                <div className="flex gap-1.5 flex-wrap">
                  {REMINDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value === null ? 'null' : opt.value}
                      type="button"
                      onClick={() => setReminderMinutes(opt.value)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        reminderMinutes === opt.value
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700'
                          : 'bg-zinc-50 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Memo */}
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="理由や備考を入力..."
                rows={2}
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder-zinc-300 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 text-sm resize-none transition-all"
              />
            </div>
          )}

          {/* Submit button - single prominent action */}
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
