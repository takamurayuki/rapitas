/**
 * DayEventsSidebar
 *
 * Right-hand panel showing the events for the currently selected date,
 * with add buttons and delete actions.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Calendar as CalendarIcon,
  Target,
  CheckCircle2,
  Circle,
  Plus,
  Clock,
  Bell,
  Trash2,
  Coffee,
} from 'lucide-react';
import type { ScheduleEvent } from '@/types';
import { getTaskDetailPath } from '@/utils/tauri';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';
import type { CalendarEvent } from '../_utils/calendarHelpers';

type Props = {
  selectedDate: string | null;
  events: CalendarEvent[];
  schedules: ScheduleEvent[];
  /** Map from date string to holiday name. */
  holidayMap: Map<string, string>;
  onAddSchedule: () => void;
  onAddTask: () => void;
  onAddPaidLeave: () => void;
  onDeleteSchedule: (eventId: number) => void;
};

/**
 * Formats a reminder duration into a human-readable label.
 *
 * @param minutes - Reminder offset in minutes.
 * @param t - Translation function from next-intl.
 * @returns Localized label string.
 */
function getReminderLabel(
  minutes: number,
  t: ReturnType<typeof useTranslations>,
): string {
  if (minutes < 60) return t('reminderMinutesBefore', { count: minutes });
  if (minutes < 1440) return t('reminderHoursBefore', { count: minutes / 60 });
  return t('reminderDaysBefore', { count: minutes / 1440 });
}

/**
 * Sidebar showing events for the selected calendar date.
 *
 * @param props - Date, events, and action handlers.
 */
export function DayEventsSidebar({
  selectedDate,
  events,
  schedules,
  holidayMap,
  onAddSchedule,
  onAddTask,
  onAddPaidLeave,
  onDeleteSchedule,
}: Props) {
  const router = useRouter();
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  const selectedDateEvents = selectedDate
    ? events.filter((e) => {
        if (e.date === selectedDate) return true;
        if (e.endDate && e.date <= selectedDate && e.endDate >= selectedDate) return true;
        return false;
      })
    : [];

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      {/* Date header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
            {selectedDate
              ? new Date(selectedDate).toLocaleDateString(dateLocale, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  weekday: 'short',
                })
              : t('selectDate')}
          </h3>
          {selectedDate && holidayMap.get(selectedDate) && (
            <p className="text-xs font-medium text-red-500 dark:text-red-400 mt-0.5">
              {holidayMap.get(selectedDate)}
            </p>
          )}
        </div>
        {selectedDate && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={onAddSchedule}
              className="flex items-center gap-1 px-2 py-1 text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('addScheduleShort')}
            </button>
            <button
              onClick={onAddTask}
              className="flex items-center gap-1 px-2 py-1 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('addTaskShort')}
            </button>
            <button
              onClick={onAddPaidLeave}
              className="flex items-center gap-1 px-2 py-1 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
            >
              <Coffee className="w-4 h-4" />
              {t('paidLeaveShort')}
            </button>
          </div>
        )}
      </div>

      {/* Event list */}
      {selectedDate ? (
        selectedDateEvents.length > 0 ? (
          <div className="space-y-3">
            {selectedDateEvents.map((event) => (
              <div
                key={`${event.type}-${event.id}`}
                className="w-full flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-left group"
              >
                <button
                  onClick={() => {
                    if (event.type === 'task') {
                      const path = getTaskDetailPath(event.id);
                      const separator = path.includes('?') ? '&' : '?';
                      router.push(`${path}${separator}showHeader=true`);
                    }
                  }}
                  className="flex items-start gap-3 flex-1 min-w-0"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: `${event.color || '#3B82F6'}20`,
                      color: event.color || '#3B82F6',
                    }}
                  >
                    {event.type === 'exam' ? (
                      <Target className="w-4 h-4" />
                    ) : event.type === 'schedule' ? (
                      schedules.find((s) => s.id === event.id)?.type === 'PAID_LEAVE' ? (
                        <Coffee className="w-4 h-4" />
                      ) : (
                        <CalendarIcon className="w-4 h-4" />
                      )
                    ) : event.status === 'done' ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-zinc-800 dark:text-zinc-200 text-sm truncate">
                      {event.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {event.type === 'exam'
                          ? t('legendExam')
                          : event.type === 'schedule'
                            ? schedules.find((s) => s.id === event.id)?.type === 'PAID_LEAVE'
                              ? t('paidLeaveLabel')
                              : t('legendSchedule')
                            : t('legendTask')}
                        {event.status === 'done' && ` ・ ${tc('completed')}`}
                      </p>
                      {event.endDate && (
                        <span className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400">
                          <CalendarIcon className="w-3 h-3" />
                          {new Date(event.date).toLocaleDateString(dateLocale, {
                            month: 'short',
                            day: 'numeric',
                          })}
                          {' 〜 '}
                          {new Date(event.endDate).toLocaleDateString(dateLocale, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                      {event.time && (
                        <span className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
                          <Clock className="w-3 h-3" />
                          {event.time}
                          {event.endTime && ` 〜 ${event.endTime}`}
                        </span>
                      )}
                      {event.reminderMinutes != null && (
                        <span className="flex items-center gap-1 text-xs text-amber-500">
                          <Bell className="w-3 h-3" />
                          {getReminderLabel(event.reminderMinutes, t)}
                        </span>
                      )}
                    </div>
                    {event.description && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 truncate">
                        {event.description}
                      </p>
                    )}
                  </div>
                </button>
                {event.type === 'schedule' && (
                  <button
                    onClick={() => onDeleteSchedule(event.id)}
                    className="p-1 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    title={tc('delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-100 dark:bg-zinc-700/50 flex items-center justify-center">
              <CalendarIcon className="w-6 h-6 text-zinc-400 dark:text-zinc-500" />
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              {t('noEventsOnDay')}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={onAddSchedule}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                {t('addSchedule')}
              </button>
              <button
                onClick={onAddPaidLeave}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors text-sm font-medium"
              >
                <Coffee className="w-4 h-4" />
                {t('paidLeaveRequest')}
              </button>
              <button
                onClick={onAddTask}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-zinc-500 dark:text-zinc-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                {t('addTask')}
              </button>
            </div>
          </div>
        )
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
          {t('selectDateFromCalendar')}
        </p>
      )}
    </div>
  );
}
