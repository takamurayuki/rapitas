'use client';

/**
 * ScheduleOptionsPanel
 *
 * Expandable options panel for the schedule event dialog.
 * Responsible for rendering color picker, reminder selector, and memo textarea.
 * Not responsible for form submission or date/time logic.
 */

import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { COLOR_OPTIONS, REMINDER_OPTIONS } from './schedule-constants';

/**
 * Formats a reminder offset value into a translated, human-readable label.
 *
 * @param value - Reminder offset in minutes, or null for "no reminder".
 * @param t - `calendar` namespace translation function.
 * @param tc - `common` namespace translation function.
 * @returns Localized label string.
 */
function getReminderOptionLabel(
  value: number | null,
  t: ReturnType<typeof useTranslations>,
  tc: ReturnType<typeof useTranslations>,
): string {
  if (value === null) return tc('none');
  if (value < 60) return t('reminderMinutesBefore', { count: value });
  if (value < 1440) return t('reminderHoursBefore', { count: value / 60 });
  return t('reminderDaysBefore', { count: value / 1440 });
}

/** Props for ScheduleOptionsPanel. */
export interface ScheduleOptionsPanelProps {
  color: string;
  setColor: (c: string) => void;
  reminderMinutes: number | null;
  setReminderMinutes: (m: number | null) => void;
  description: string;
  setDescription: (d: string) => void;
}

/**
 * Renders the color, reminder, and memo options in the event creation dialog.
 */
export function ScheduleOptionsPanel({
  color,
  setColor,
  reminderMinutes,
  setReminderMinutes,
  description,
  setDescription,
}: ScheduleOptionsPanelProps) {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const tp = useTranslations('calendar.scheduleOptionsPanel');
  return (
    <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
      {/* Color picker */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-400 dark:text-zinc-500 w-10 shrink-0">
          {tc('color')}
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
                ...(color === c.value ? { ['--tw-ring-color' as string]: c.value } : {}),
              }}
            />
          ))}
        </div>
      </div>

      {/* Reminder */}
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
              {getReminderOptionLabel(opt.value, t, tc)}
            </button>
          ))}
        </div>
      </div>

      {/* Memo */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={tp('memoPlaceholder')}
        rows={2}
        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder-zinc-300 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-400 text-sm resize-none transition-all"
      />
    </div>
  );
}
