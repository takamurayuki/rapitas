/**
 * ScheduleListing
 *
 * The month calendar's read: stored events plus the occurrences a recurring
 * event only implies.
 *
 * A repeating event is ONE row carrying an RRULE — the occurrences the
 * calendar draws are generated here and exist nowhere in the database. This
 * was inline in routes/scheduling/schedules.ts until #1270 needed a second
 * reader (the shared calendar). A second reader that queried the table
 * directly would render a calendar with every repeating event missing and
 * raise nothing, so there is exactly one copy of this and both callers use
 * it.
 *
 * NOT responsible for deciding WHOSE calendar is being read: the workspace
 * scope layer answers that from the current workspace, which is why the
 * shared read runs this inside the owner's scope.
 */
import { parseRRule, expandRecurrence } from './recurrence-service';
import { createLogger } from '../../config/logger';

const log = createLogger('scheduling:schedule-listing');

/** Days either side of today when the caller names no window. */
const DEFAULT_PAST_DAYS = 30;
const DEFAULT_FUTURE_DAYS = 90;

/**
 * The fields the expansion reads. Rows carry more and are passed through
 * untouched, so the shape a caller gets back is the shape its delegate
 * returned.
 */
export interface RecurrenceShape {
  id: number;
  startAt: Date;
  endAt: Date | null;
  recurrenceRule: string | null;
  recurrenceEnd: Date | null;
  parentEventId: number | null;
  originalDate: Date | null;
  isRecurrenceException: boolean;
}

/**
 * The one method this module needs from `prisma.scheduleEvent`.
 *
 * Injected rather than imported so the expansion can be driven by a fake
 * table: the alternative is `mock.module` on the Prisma client, which bun
 * applies process-wide to every other test file in the run.
 */
export interface ScheduleEventFinder<Row extends RecurrenceShape> {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<Row[]>;
}

/** `2026-01-12` — the granularity an exception replaces an occurrence at. */
function dayKey(parentEventId: number | null, date: Date | null): string {
  return `${parentEventId}:${date?.toISOString().split('T')[0]}`;
}

/**
 * Stored events in the window, plus the generated occurrences of every
 * recurring event, minus the ones an edited instance replaces.
 *
 * @param events - Schedule-event delegate / 予定デリゲート
 * @param range - Window to read; defaults to -30/+90 days / 読み出す期間（既定は前30日・後90日）
 * @returns Everything the calendar should draw, earliest first / 描画対象の全予定（開始順）
 */
export async function listScheduleEvents<Row extends RecurrenceShape>(
  events: ScheduleEventFinder<Row>,
  range: { from?: Date; to?: Date } = {},
): Promise<Row[]> {
  const { from, to } = range;
  const rangeStart = from ?? new Date(Date.now() - DEFAULT_PAST_DAYS * 86400000);
  const rangeEnd = to ?? new Date(Date.now() + DEFAULT_FUTURE_DAYS * 86400000);

  // The window bounds the stored rows only when the caller asked for one —
  // the behaviour this had as a route, kept so a bare GET still returns what
  // it always did.
  const storedWhere: Record<string, unknown> = { recurrenceRule: null, parentEventId: null };
  if (from || to) {
    const startAt: Record<string, unknown> = {};
    if (from) startAt.gte = from;
    if (to) startAt.lte = to;
    storedWhere.startAt = startAt;
  }

  const [stored, parents, exceptions] = await Promise.all([
    events.findMany({ where: storedWhere, orderBy: { startAt: 'asc' } }),
    // Unbounded on purpose: a parent that started years ago still produces
    // occurrences in this window, so it cannot be filtered by its own date.
    events.findMany({ where: { recurrenceRule: { not: null }, parentEventId: null } }),
    events.findMany({
      where: { isRecurrenceException: true, startAt: { gte: rangeStart, lte: rangeEnd } },
    }),
  ]);

  const replaced = new Set(
    exceptions.map((event) => dayKey(event.parentEventId, event.originalDate)),
  );

  const occurrences: Row[] = [];
  for (const parent of parents) {
    if (!parent.recurrenceRule) continue;
    try {
      const dates = expandRecurrence(
        parent.startAt,
        parseRRule(parent.recurrenceRule),
        rangeStart,
        rangeEnd,
        parent.recurrenceEnd,
      );
      const duration = parent.endAt ? parent.endAt.getTime() - parent.startAt.getTime() : 0;
      for (const date of dates) {
        if (replaced.has(dayKey(parent.id, date))) continue;
        occurrences.push({
          ...parent,
          // NOTE: the virtual id formula is carried over from the route
          // unchanged — the frontend keys rows by it, so a different scheme
          // is a frontend change, not a refactor.
          id: parent.id * 10000 + (Math.floor(date.getTime() / 86400000) % 10000),
          startAt: date,
          endAt: duration > 0 ? new Date(date.getTime() + duration) : null,
          parentEventId: parent.id,
        });
      }
    } catch (err) {
      // One unreadable rule must not empty the month.
      log.error({ err, eventId: parent.id }, 'could not expand a recurrence');
    }
  }

  return [...stored, ...occurrences, ...exceptions].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
}
