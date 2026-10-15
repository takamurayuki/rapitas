import { describe, it, expect } from 'vitest';
import {
  getDaysInMonth,
  formatDateStr,
  getEventsForDateStr,
  getMultiDayBars,
  type CalendarEvent,
} from '../calendar-helpers';

describe('getDaysInMonth', () => {
  it('returns no leading nulls when the month starts on Sunday', () => {
    // 2026-02-01 is a Sunday; February 2026 has 28 days (not a leap year).
    const days = getDaysInMonth(new Date(2026, 1, 1));
    expect(days).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  it('pads leading nulls when the month does not start on Sunday', () => {
    // 2026-01-01 is a Thursday (4 leading nulls); January has 31 days.
    const days = getDaysInMonth(new Date(2026, 0, 1));
    expect(days.slice(0, 4)).toEqual([null, null, null, null]);
    expect(days.filter((d) => d !== null)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(days).toHaveLength(35);
  });
});

describe('formatDateStr', () => {
  it('formats a day within the reference month with zero-padding', () => {
    expect(formatDateStr(new Date(2026, 0, 15), 5)).toBe('2026-01-05');
  });

  it('zero-pads a double-digit month and day', () => {
    expect(formatDateStr(new Date(2026, 10, 1), 23)).toBe('2026-11-23');
  });
});

describe('getEventsForDateStr', () => {
  const single: CalendarEvent = {
    id: 1,
    title: 'Single day',
    date: '2026-02-10',
    type: 'task',
  };
  const spanning: CalendarEvent = {
    id: 2,
    title: 'Multi day',
    date: '2026-02-08',
    endDate: '2026-02-12',
    type: 'schedule',
  };

  it('matches an event on its exact single date', () => {
    expect(getEventsForDateStr([single, spanning], '2026-02-10')).toEqual(
      expect.arrayContaining([single, spanning]),
    );
  });

  it('matches a spanning event for any date within its range', () => {
    expect(getEventsForDateStr([spanning], '2026-02-09')).toEqual([spanning]);
    expect(getEventsForDateStr([spanning], '2026-02-08')).toEqual([spanning]);
    expect(getEventsForDateStr([spanning], '2026-02-12')).toEqual([spanning]);
  });

  it('excludes a spanning event for a date outside its range', () => {
    expect(getEventsForDateStr([spanning], '2026-02-13')).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(getEventsForDateStr([single], '2026-03-01')).toEqual([]);
  });
});

describe('getMultiDayBars', () => {
  const currentDate = new Date(2026, 1, 1); // February 2026, starts on Sunday

  function scheduleEvent(id: number, date: string, endDate: string): CalendarEvent {
    return { id, title: `event-${id}`, date, endDate, type: 'schedule' };
  }

  it('ignores non-schedule events even if they have an endDate', () => {
    const taskEvent: CalendarEvent = {
      id: 1,
      title: 'task',
      date: '2026-02-01',
      endDate: '2026-02-03',
      type: 'task',
    };
    expect(getMultiDayBars([taskEvent], currentDate)).toEqual([]);
  });

  it('ignores events entirely outside the visible month', () => {
    const outside = scheduleEvent(1, '2026-01-01', '2026-01-05');
    expect(getMultiDayBars([outside], currentDate)).toEqual([]);
  });

  it('produces a single segment for an event that fits within one week row', () => {
    const event = scheduleEvent(1, '2026-02-01', '2026-02-03');
    const bars = getMultiDayBars([event], currentDate);
    expect(bars).toEqual([
      {
        event,
        gridCol: 0,
        gridRow: 0,
        span: 3,
        isStart: true,
        isEnd: true,
        lane: 0,
      },
    ]);
  });

  it('splits an event that crosses a week boundary into multiple segments', () => {
    // Friday Feb 6 -> Monday Feb 9 (crosses into the next grid row).
    const event = scheduleEvent(1, '2026-02-06', '2026-02-09');
    const bars = getMultiDayBars([event], currentDate);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({
      event,
      gridCol: 5,
      gridRow: 0,
      span: 2,
      isStart: true,
      isEnd: false,
      lane: 0,
    });
    expect(bars[1]).toEqual({
      event,
      gridCol: 0,
      gridRow: 1,
      span: 2,
      isStart: false,
      isEnd: true,
      lane: 0,
    });
  });

  it('assigns overlapping events to separate stacking lanes', () => {
    const eventA = scheduleEvent(1, '2026-02-01', '2026-02-02');
    const eventB = scheduleEvent(2, '2026-02-01', '2026-02-02');
    const bars = getMultiDayBars([eventA, eventB], currentDate);
    expect(bars).toHaveLength(2);
    expect(bars[0].lane).toBe(0);
    expect(bars[1].lane).toBe(1);
    expect(bars[0].gridRow).toBe(bars[1].gridRow);
  });

  it('clips a segment that starts before the visible month and marks isStart false', () => {
    // Starts in January, ends within February.
    const event = scheduleEvent(1, '2026-01-30', '2026-02-02');
    const bars = getMultiDayBars([event], currentDate);
    expect(bars).toHaveLength(1);
    expect(bars[0].gridCol).toBe(0); // clipped to Feb 1 (Sunday)
    expect(bars[0].span).toBe(2); // Feb 1 - Feb 2
    expect(bars[0].isStart).toBe(false); // real start is in January
    expect(bars[0].isEnd).toBe(true);
  });
});
