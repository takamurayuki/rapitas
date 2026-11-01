/**
 * schedule-listing.test
 *
 * The month calendar's read, pulled out of routes/scheduling/schedules.ts so
 * the shared-calendar read uses the same one (#1270).
 *
 * That matters more than it sounds: a recurring event is ONE row with an
 * RRULE, and the occurrences the calendar draws do not exist in the
 * database. A second reader that queried the table directly would show a
 * shared calendar with every weekly meeting missing and no error anywhere —
 * which is exactly the kind of hole that survives being tested by hand.
 *
 * So these tests are about what the expansion has to get right: occurrences
 * inside the window, an edited occurrence replacing its generated twin, and
 * one broken rule not taking the rest of the month with it.
 */
import { describe, test, expect } from 'bun:test';
import {
  listScheduleEvents,
  type RecurrenceShape,
  type ScheduleEventFinder,
} from './schedule-listing';

/** A row as the fake table holds it. A type, so it stays assignable. */
type Row = RecurrenceShape & { title: string };

const JAN = (day: number, hour = 9): Date => new Date(Date.UTC(2026, 0, day, hour));

function row(partial: Partial<Row> & { id: number; title: string; startAt: Date }): Row {
  return {
    endAt: null,
    recurrenceRule: null,
    recurrenceEnd: null,
    parentEventId: null,
    originalDate: null,
    isRecurrenceException: false,
    ...partial,
  };
}

/**
 * A stand-in for `prisma.scheduleEvent` that answers the three queries this
 * module makes, and refuses anything else.
 *
 * It interprets the `where` rather than ignoring it, so the SHAPE of each
 * query is part of what these tests hold: if the module stops asking for
 * exceptions, or stops excluding child rows, a test fails instead of the
 * fake quietly handing back everything.
 */
function fakeEvents(
  rows: Row[],
): ScheduleEventFinder<Row> & { queries: Record<string, unknown>[] } {
  const queries: Record<string, unknown>[] = [];
  return {
    queries,
    findMany: async (args) => {
      const where = args.where;
      queries.push(where);
      const range = where.startAt as { gte?: Date; lte?: Date } | undefined;
      const inRange = (r: Row) =>
        (range?.gte === undefined || r.startAt >= range.gte) &&
        (range?.lte === undefined || r.startAt <= range.lte);

      if (where.isRecurrenceException === true) {
        return rows.filter((r) => r.isRecurrenceException && inRange(r));
      }
      if (where.recurrenceRule === null) {
        return rows.filter(
          (r) => r.recurrenceRule === null && r.parentEventId === null && inRange(r),
        );
      }
      if ((where.recurrenceRule as { not?: unknown } | undefined)?.not === null) {
        return rows.filter((r) => r.recurrenceRule !== null && r.parentEventId === null);
      }
      throw new Error(`unexpected query: ${JSON.stringify(where)}`);
    },
  };
}

const WINDOW = { from: JAN(1, 0), to: JAN(31, 23) };

describe('plain events', () => {
  test('returns the ones inside the window', async () => {
    const events = fakeEvents([
      row({ id: 1, title: '面談', startAt: JAN(5) }),
      row({ id: 2, title: '来月', startAt: new Date(Date.UTC(2026, 1, 20, 9)) }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    expect(listed.map((e) => e.title)).toEqual(['面談']);
  });

  test('leaves out the generated children of a recurring parent', async () => {
    // They are regenerated below; returning the stored ones too would draw
    // every occurrence twice.
    const events = fakeEvents([
      row({ id: 1, title: '親', startAt: JAN(5) }),
      row({ id: 2, title: '子', startAt: JAN(6), parentEventId: 1 }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    expect(listed.map((e) => e.title)).toEqual(['親']);
  });

  test('sorts everything by start time', async () => {
    const events = fakeEvents([
      row({ id: 1, title: '後', startAt: JAN(20) }),
      row({ id: 2, title: '先', startAt: JAN(3) }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    expect(listed.map((e) => e.title)).toEqual(['先', '後']);
  });
});

describe('recurring events', () => {
  test('expands a weekly rule into the occurrences in the window', async () => {
    const events = fakeEvents([
      row({
        id: 7,
        title: '週会',
        startAt: JAN(5),
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
      }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    expect(listed.map((e) => e.startAt.getUTCDate())).toEqual([5, 12, 19, 26]);
    expect(listed.every((e) => e.title === '週会')).toBe(true);
  });

  test('points every generated occurrence at its parent', async () => {
    const events = fakeEvents([
      row({ id: 7, title: '週会', startAt: JAN(5), recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1' }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    expect(listed.every((e) => e.parentEventId === 7)).toBe(true);
  });

  test('gives each occurrence its own id', async () => {
    // The frontend keys rows by id. Reusing the parent's would collapse the
    // month into one entry.
    const events = fakeEvents([
      row({ id: 7, title: '週会', startAt: JAN(5), recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1' }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    expect(new Set(listed.map((e) => e.id)).size).toBe(listed.length);
  });

  test('carries the parent duration onto each occurrence', async () => {
    const events = fakeEvents([
      row({
        id: 7,
        title: '週会',
        startAt: JAN(5, 9),
        endAt: JAN(5, 10),
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
      }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    for (const event of listed) {
      expect(event.endAt).not.toBeNull();
      expect((event.endAt as Date).getTime() - event.startAt.getTime()).toBe(60 * 60 * 1000);
    }
  });

  test('stops at recurrenceEnd', async () => {
    const events = fakeEvents([
      row({
        id: 7,
        title: '週会',
        startAt: JAN(5),
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
        recurrenceEnd: JAN(13),
      }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    expect(listed.map((e) => e.startAt.getUTCDate())).toEqual([5, 12]);
  });

  test('keeps the rest of the month when one rule cannot be read', async () => {
    const events = fakeEvents([
      row({ id: 7, title: '壊れた規則', startAt: JAN(5), recurrenceRule: 'FREQ=NONSENSE' }),
      row({ id: 8, title: '普通の予定', startAt: JAN(6) }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    expect(listed.map((e) => e.title)).toContain('普通の予定');
  });
});

describe('an occurrence someone edited', () => {
  /**
   * Editing one occurrence of a repeating event stores a real row with
   * `isRecurrenceException` and the date it replaces. The generated twin for
   * that date has to disappear, or the calendar shows the meeting at both
   * the old time and the new one.
   */
  test('replaces the generated occurrence for its date', async () => {
    const events = fakeEvents([
      row({ id: 7, title: '週会', startAt: JAN(5), recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1' }),
      row({
        id: 99,
        title: '週会（時間変更）',
        startAt: JAN(12, 15),
        parentEventId: 7,
        originalDate: JAN(12, 0),
        isRecurrenceException: true,
      }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    const twelfth = listed.filter((e) => e.startAt.getUTCDate() === 12);
    expect(twelfth).toHaveLength(1);
    expect(twelfth[0]?.title).toBe('週会（時間変更）');
  });

  test('leaves the other occurrences alone', async () => {
    const events = fakeEvents([
      row({ id: 7, title: '週会', startAt: JAN(5), recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1' }),
      row({
        id: 99,
        title: '週会（時間変更）',
        startAt: JAN(12, 15),
        parentEventId: 7,
        originalDate: JAN(12, 0),
        isRecurrenceException: true,
      }),
    ]);
    const listed = await listScheduleEvents(events, WINDOW);
    expect(listed.map((e) => e.startAt.getUTCDate())).toEqual([5, 12, 19, 26]);
  });
});

describe('the window', () => {
  test('asks the database for a default window when given none', async () => {
    // The route behaved this way before the extraction: a bare GET returns
    // the month either side of today rather than the entire table.
    const events = fakeEvents([]);
    await listScheduleEvents(events);
    const exceptionQuery = events.queries.find((q) => q.isRecurrenceException === true);
    const range = exceptionQuery?.startAt as { gte: Date; lte: Date };
    const days = (range.lte.getTime() - range.gte.getTime()) / 86400000;
    expect(Math.round(days)).toBe(120);
  });

  test('does not bound the plain-event query when given no window', async () => {
    // Also the previous behaviour: from/to filter the stored rows only when
    // the caller asked for them.
    const events = fakeEvents([]);
    await listScheduleEvents(events);
    const plainQuery = events.queries.find((q) => q.recurrenceRule === null);
    expect(plainQuery?.startAt).toBeUndefined();
  });
});
