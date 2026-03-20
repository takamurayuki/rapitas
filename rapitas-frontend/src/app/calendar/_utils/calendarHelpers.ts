/**
 * calendarHelpers
 *
 * Pure utility functions for calendar grid calculations and multi-day event
 * bar layout. No React dependencies; safe to test in isolation.
 */

export type CalendarEvent = {
  id: number;
  title: string;
  date: string;
  endDate?: string;
  type: 'task' | 'exam' | 'schedule';
  status?: string;
  color?: string;
  time?: string;
  endTime?: string;
  reminderMinutes?: number | null;
  description?: string | null;
};

export type BarSegment = {
  event: CalendarEvent;
  /** Zero-based column index within the week row (0 = Sunday). */
  gridCol: number;
  /** Zero-based week row index within the month grid. */
  gridRow: number;
  /** Number of columns this segment spans. */
  span: number;
  isStart: boolean;
  isEnd: boolean;
  /** Vertical stacking lane within the cell (0, 1, 2…). */
  lane: number;
};

/**
 * Returns an array of day numbers (with leading nulls for the starting weekday)
 * for the given month.
 *
 * @param date - Any date in the target month.
 * @returns Array of day numbers and nulls representing the calendar grid.
 */
export function getDaysInMonth(date: Date): (number | null)[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDay = firstDay.getDay();

  const days: (number | null)[] = [];
  for (let i = 0; i < startingDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  return days;
}

/**
 * Formats a day number within the current month as a YYYY-MM-DD string.
 *
 * @param currentDate - Reference month date.
 * @param day - Day number within that month.
 * @returns ISO date string.
 */
export function formatDateStr(currentDate: Date, day: number): string {
  const year = currentDate.getFullYear();
  const month = String(currentDate.getMonth() + 1).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  return `${year}-${month}-${dayStr}`;
}

/**
 * Returns all events that fall on a specific day, including multi-day spans.
 *
 * @param events - Full event list.
 * @param dateStr - Target date as YYYY-MM-DD.
 * @returns Events that cover the given date.
 */
export function getEventsForDateStr(
  events: CalendarEvent[],
  dateStr: string,
): CalendarEvent[] {
  return events.filter((e) => {
    if (e.date === dateStr) return true;
    if (e.endDate && e.date <= dateStr && e.endDate >= dateStr) return true;
    return false;
  });
}

/**
 * Computes multi-day bar segments for rendering spanning schedule events.
 * Each segment represents a portion of an event within a single week row.
 *
 * @param events - Full event list.
 * @param currentDate - Reference month date.
 * @returns Array of bar segments sorted by week row and lane.
 */
export function getMultiDayBars(
  events: CalendarEvent[],
  currentDate: Date,
): BarSegment[] {
  const multiDayEvents = events.filter(
    (e) => e.endDate && e.type === 'schedule',
  );

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const startingWeekday = firstDayOfMonth.getDay();

  const getGridPosition = (day: number) => {
    const index = startingWeekday + day - 1;
    return { col: index % 7, row: Math.floor(index / 7) };
  };

  const bars: BarSegment[] = [];
  const cellLanes: Map<string, Set<number>> = new Map();

  for (const event of multiDayEvents) {
    const eventStart = new Date(event.date + 'T00:00:00');
    const eventEnd = new Date(event.endDate! + 'T00:00:00');

    const visibleStart =
      eventStart < firstDayOfMonth ? firstDayOfMonth : eventStart;
    const visibleEnd = eventEnd > lastDayOfMonth ? lastDayOfMonth : eventEnd;

    if (visibleStart > lastDayOfMonth || visibleEnd < firstDayOfMonth) continue;

    const startDay = visibleStart.getDate();
    const endDay = visibleEnd.getDate();
    let currentDay = startDay;

    while (currentDay <= endDay) {
      const pos = getGridPosition(currentDay);
      const remainInWeek = 7 - pos.col;
      const remainInEvent = endDay - currentDay + 1;
      const span = Math.min(remainInWeek, remainInEvent);

      // Find first available lane across all cells in this span
      let lane = 0;
      let laneFound = false;
      while (!laneFound) {
        laneFound = true;
        for (let d = currentDay; d < currentDay + span; d++) {
          const key = `${pos.row}-${getGridPosition(d).col}`;
          const used = cellLanes.get(key);
          if (used && used.has(lane)) {
            laneFound = false;
            lane++;
            break;
          }
        }
      }

      for (let d = currentDay; d < currentDay + span; d++) {
        const key = `${pos.row}-${getGridPosition(d).col}`;
        if (!cellLanes.has(key)) cellLanes.set(key, new Set());
        cellLanes.get(key)!.add(lane);
      }

      const isEventStart =
        eventStart.getMonth() === month && currentDay === eventStart.getDate();
      const isEventEnd =
        eventEnd.getMonth() === month &&
        currentDay + span - 1 === eventEnd.getDate();

      bars.push({
        event,
        gridCol: pos.col,
        gridRow: pos.row,
        span,
        isStart: isEventStart,
        isEnd: isEventEnd,
        lane,
      });

      currentDay += span;
    }
  }

  return bars;
}
