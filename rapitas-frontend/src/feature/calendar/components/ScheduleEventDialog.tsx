'use client';
import { useState, useRef, useEffect } from 'react';
import { X, Clock, Bell, ChevronDown, CalendarDays } from 'lucide-react';
import type { ScheduleEventInput } from '@/types';

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
  { value: '#6366F1', label: 'Indigo' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#10B981', label: 'Green' },
  { value: '#F59E0B', label: 'Amber' },
  { value: '#EF4444', label: 'Red' },
  { value: '#EC4899', label: 'Pink' },
  { value: '#8B5CF6', label: 'Violet' },
  { value: '#06B6D4', label: 'Cyan' },
];

const QUICK_TIMES = [
  { start: '09:00', end: '10:00', label: '午前' },
  { start: '12:00', end: '13:00', label: '昼' },
  { start: '15:00', end: '16:00', label: '午後' },
  { start: '19:00', end: '20:00', label: '夜' },
];

type Props = {
  selectedDate: string;
  onClose: () => void;
  onSubmit: (data: ScheduleEventInput) => Promise<void>;
};

// Get smart default times based on current time
function getDefaultTimes(): { start: string; end: string } {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();

  // Round up to next 30-min slot
  let startHour = currentHour;
  let startMin = currentMin <= 30 ? 30 : 0;
  if (currentMin > 30) startHour += 1;

  // 24時間制をサポート
  if (startHour >= 24) {
    startHour = 9;
    startMin = 0;
  }

  const endHour = (startHour + 1) % 24; // 24時間制をサポート

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `${pad(startHour)}:${pad(startMin)}`,
    end: `${pad(endHour)}:${pad(startMin)}`,
  };
}

export default function ScheduleEventDialog({
  selectedDate,
  onClose,
  onSubmit,
}: Props) {
  const defaults = getDefaultTimes();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(selectedDate);
  const [endDate, setEndDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState(defaults.start);
  const [endTime, setEndTime] = useState(defaults.end);
  const [isAllDay, setIsAllDay] = useState(false);
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [color, setColor] = useState('#6366F1');
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(15);
  const [submitting, setSubmitting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      // 日付・時刻文字列からUTCのISO文字列を生成するヘルパー
      // ローカルタイムゾーンの影響を受けないよう Date.UTC を使用
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
          // 同日で終了時刻が開始時刻より早い場合（例：23:00開始→02:00終了）、翌日とみなす
          const [startH] = startTime.split(':').map(Number);
          const [endH] = endTime.split(':').map(Number);
          if (endH < startH) {
            // 翌日の終了時刻として設定
            const nextDay = new Date(startDate);
            nextDay.setDate(nextDay.getDate() + 1);
            const [year, month, day] = nextDay
              .toISOString()
              .split('T')[0]
              .split('-')
              .map(Number);
            const [hour, min] = endTime.split(':').map(Number);
            endAt = new Date(
              Date.UTC(year, month - 1, day, hour, min, 0),
            ).toISOString();
          } else {
            endAt = toUTCISO(startDate, endTime);
          }
        }
      }

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

  const formattedStartDate = new Date(startDate).toLocaleDateString('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  const formattedEndDate =
    isMultiDay && endDate > startDate
      ? new Date(endDate).toLocaleDateString('ja-JP', {
          month: 'long',
          day: 'numeric',
          weekday: 'short',
        })
      : null;

  const dayOfWeek = new Date(startDate).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // 複数日の日数計算
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

        {/* Header - date display */}
        <div className="px-5 pt-4 pb-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl flex flex-col items-center justify-center text-white font-bold shadow-sm"
                style={{ backgroundColor: color }}
              >
                <span className="text-[10px] leading-none opacity-80 uppercase">
                  {new Date(startDate).toLocaleDateString('ja-JP', {
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
          {/* Divider */}
          <div className="h-px bg-zinc-200 dark:bg-zinc-700" />
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 pt-4 pb-5">
          {/* Title - most prominent */}
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
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  isAllDay
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                }`}
              >
                終日
              </button>
              <button
                type="button"
                onClick={() => setIsAllDay(false)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
                  !isAllDay
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                時間指定
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
                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-300 dark:ring-indigo-700'
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
                {/* Quick time buttons */}
                <div className="flex gap-1.5">
                  {QUICK_TIMES.map((qt) => (
                    <button
                      key={qt.label}
                      type="button"
                      onClick={() => {
                        setStartTime(qt.start);
                        setEndTime(qt.end);
                      }}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        startTime === qt.start && endTime === qt.end
                          ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-300 dark:ring-indigo-700'
                          : 'bg-zinc-50 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {qt.label}
                    </button>
                  ))}
                </div>

                {/* Custom time inputs */}
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => {
                      setStartTime(e.target.value);
                      // Auto-adjust end time to 1 hour after start (支援24時間制)
                      const [h, m] = e.target.value.split(':').map(Number);
                      const endH = (h + 1) % 24; // 24時間制をサポート（23:00→00:00）
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
                placeholder="メモを追加..."
                rows={2}
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder-zinc-300 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 text-sm resize-none transition-all"
              />
            </div>
          )}

          {/* Submit button - single prominent action */}
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className={`mt-4 w-full py-3 rounded-xl font-medium text-white transition-all disabled:cursor-not-allowed active:scale-[0.98] ${
              !title.trim() ? 'bg-zinc-300 dark:bg-zinc-600 opacity-40' : ''
            }`}
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
