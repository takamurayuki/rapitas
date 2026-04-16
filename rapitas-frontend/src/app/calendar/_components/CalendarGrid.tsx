'use client';
// CalendarGrid

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Coffee } from 'lucide-react';
import type { ScheduleEvent } from '@/types';
import { getHolidaysForMonth } from '@/utils/holidays';
import {
  getDaysInMonth,
  formatDateStr,
  getEventsForDateStr,
  getMultiDayBars,
  type CalendarEvent,
} from '../_utils/calendar-helpers';

const MAX_VISIBLE_EVENTS = 3;

type Props = {
  currentDate: Date;
  events: CalendarEvent[];
  schedules: ScheduleEvent[];
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
  onDoubleClickDate: (dateStr: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onGoToToday: () => void;
};

/**
 * Monthly calendar grid with navigation and event rendering.
 *
 * @param props - Grid data and interaction callbacks.
 */
export function CalendarGrid({
  currentDate,
  events,
  schedules,
  selectedDate,
  onSelectDate,
  onDoubleClickDate,
  onPrevMonth,
  onNextMonth,
  onGoToToday,
}: Props) {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');

  const weekDays = [
    t('weekSun'),
    t('weekMon'),
    t('weekTue'),
    t('weekWed'),
    t('weekThu'),
    t('weekFri'),
    t('weekSat'),
  ];

  const days = getDaysInMonth(currentDate);
  const multiDayBars = getMultiDayBars(events, currentDate);

  const holidays = useMemo(
    () =>
      getHolidaysForMonth(currentDate.getFullYear(), currentDate.getMonth()),
    [currentDate],
  );

  const holidayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidays) map.set(h.date, h.name);
    return map;
  }, [holidays]);

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getFullYear() === today.getFullYear()
    );
  };

  // Chunk days into weeks and pad the last row
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const lastWeek = weeks[weeks.length - 1];
  while (lastWeek.length < 7) lastWeek.push(null);

  return (
    <div className="lg:col-span-2 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={onPrevMonth}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 min-w-[140px] text-center">
            {t('yearMonth', {
              year: currentDate.getFullYear(),
              month: currentDate.getMonth() + 1,
            })}
          </h2>
          <button
            onClick={onNextMonth}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <button
          onClick={onGoToToday}
          className="px-3 py-1.5 text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50"
        >
          {tc('today')}
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map((day, index) => (
          <div
            key={day}
            className={`text-center text-sm font-medium py-2 ${
              index === 0
                ? 'text-red-500'
                : index === 6
                  ? 'text-blue-500'
                  : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week, weekIndex) => {
        const weekBars = multiDayBars.filter((b) => b.gridRow === weekIndex);
        const maxLaneInWeek =
          weekBars.length > 0
            ? Math.max(...weekBars.map((b) => b.lane)) + 1
            : 0;
        const barAreaHeight = maxLaneInWeek * 18;

        return (
          <div key={`week-${weekIndex}`} className="relative">
            <div className="grid grid-cols-7">
              {week.map((day, colIndex) => {
                if (day === null) {
                  return (
                    <div
                      key={`empty-${weekIndex}-${colIndex}`}
                      className="border border-zinc-100 dark:border-zinc-700/50 flex flex-col bg-zinc-100/70 dark:bg-zinc-900/50"
                    >
                      <div className="w-full px-1 py-0.5 bg-zinc-200/50 dark:bg-zinc-800/90">
                        <div className="w-5 h-5" />
                      </div>
                      <div className="w-full border-b border-zinc-200/50 dark:border-zinc-700/30" />
                      <div className="w-full aspect-square bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(0,0,0,0.03)_4px,rgba(0,0,0,0.03)_5px)] dark:bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(255,255,255,0.02)_4px,rgba(255,255,255,0.02)_5px)]" />
                    </div>
                  );
                }

                const dateStr = formatDateStr(currentDate, day);
                const dayEvents = getEventsForDateStr(events, dateStr);
                const singleDayEvents = dayEvents.filter(
                  (e) => !(e.endDate && e.type === 'schedule'),
                );
                const isSelected = selectedDate === dateStr;
                const today = isToday(day);
                const dayOfWeek = colIndex;
                const holidayName = holidayMap.get(dateStr);
                const isHoliday = !!holidayName;
                const hiddenCount = singleDayEvents.length - MAX_VISIBLE_EVENTS;

                return (
                  <button
                    key={day}
                    onClick={() => onSelectDate(dateStr)}
                    onDoubleClick={() => onDoubleClickDate(dateStr)}
                    className={`p-0 transition-all border border-zinc-200 dark:border-zinc-700/50 text-left flex flex-col relative ${
                      isSelected
                        ? 'outline-2 outline-indigo-500 -outline-offset-2 z-10'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
                    }`}
                  >
                    <div
                      className={`w-full flex items-center px-1 py-0.5 gap-0.5 min-w-0 ${
                        isSelected
                          ? 'bg-indigo-50 dark:bg-indigo-900/30'
                          : isHoliday
                            ? 'bg-red-50 dark:bg-red-900/15'
                            : 'bg-zinc-50 dark:bg-zinc-800/80'
                      }`}
                    >
                      <div
                        className={`flex items-center justify-center w-5 h-5 rounded-sm shrink-0 ${
                          today ? 'bg-indigo-500' : ''
                        }`}
                      >
                        <span
                          className={`text-xs font-semibold leading-none ${
                            today
                              ? 'text-white'
                              : dayOfWeek === 0 || isHoliday
                                ? 'text-red-500'
                                : dayOfWeek === 6
                                  ? 'text-blue-500'
                                  : 'text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          {day}
                        </span>
                      </div>
                    </div>
                    <div className="w-full border-b border-zinc-200 dark:border-zinc-600/60" />
                    <div className="w-full aspect-square relative">
                      {barAreaHeight > 0 && (
                        <div style={{ height: barAreaHeight }} />
                      )}
                      <div className="px-0.5 py-0.5 space-y-0.5 overflow-hidden">
                        {singleDayEvents
                          .slice(0, MAX_VISIBLE_EVENTS)
                          .map((event) => {
                            let bgColor = event.color || '#3B82F6';
                            let eventIcon = null;

                            if (event.type === 'exam') {
                              bgColor = event.color || '#10B981';
                            } else if (event.type === 'schedule') {
                              const scheduleEvent = schedules.find(
                                (s) => s.id === event.id,
                              );
                              if (scheduleEvent?.type === 'PAID_LEAVE') {
                                bgColor = event.color || '#FF6B6B';
                                eventIcon = (
                                  <Coffee className="w-2.5 h-2.5 shrink-0 opacity-80" />
                                );
                              } else {
                                bgColor = event.color || '#6366F1';
                              }
                            }

                            return (
                              <div
                                key={`${event.type}-${event.id}`}
                                className="flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight font-medium truncate"
                                style={{
                                  backgroundColor: `${bgColor}18`,
                                  color: bgColor,
                                  borderLeft: `2px solid ${bgColor}`,
                                }}
                              >
                                {eventIcon}
                                {event.time && (
                                  <span className="shrink-0 opacity-70">
                                    {event.time}
                                  </span>
                                )}
                                <span className="truncate">{event.title}</span>
                              </div>
                            );
                          })}
                        {hiddenCount > 0 && (
                          <div className="text-[9px] text-zinc-400 dark:text-zinc-500 pl-1 leading-tight">
                            +{hiddenCount}
                            {tc('items')}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Multi-day bars overlay */}
            {weekBars.map((bar, i) => {
              const color = bar.event.color || '#6366F1';
              const leftPercent = (bar.gridCol / 7) * 100;
              const widthPercent = (bar.span / 7) * 100;

              return (
                <div
                  key={`bar-${bar.event.id}-${weekIndex}-${i}`}
                  className="absolute pointer-events-none"
                  style={{
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                    top: `${25 + bar.lane * 18}px`,
                    height: '16px',
                    paddingLeft: '1px',
                    paddingRight: '1px',
                  }}
                >
                  <div
                    className="h-full flex items-center overflow-hidden text-[10px] font-medium text-white leading-none px-1.5"
                    style={{
                      backgroundColor: color,
                      opacity: 0.9,
                      borderRadius: `${bar.isStart ? '3px' : '0'} ${bar.isEnd ? '3px' : '0'} ${bar.isEnd ? '3px' : '0'} ${bar.isStart ? '3px' : '0'}`,
                    }}
                  >
                    {bar.isStart && (
                      <span className="truncate">{bar.event.title}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-700">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="w-8 h-3 rounded-sm bg-indigo-500 opacity-90" />
            {t('legendMultiDay')}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="w-1 h-3 rounded-sm bg-indigo-500" />
            {t('legendSchedule')}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="w-1 h-3 rounded-sm bg-blue-500" />
            {t('legendTask')}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="w-1 h-3 rounded-sm bg-emerald-500" />
            {t('legendExam')}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="text-[10px] font-medium text-red-500">
              {t('legendHolidayIcon')}
            </span>
            {t('legendHoliday')}
          </div>
        </div>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 hidden sm:inline">
          {t('doubleClickToAdd')}
        </span>
      </div>
    </div>
  );
}
