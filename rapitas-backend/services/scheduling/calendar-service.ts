/**
 * Calendar Service
 * カレンダーイベントの取得・作成・競合チェック
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('calendar-service');

export interface CalendarEventInput {
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  allDay?: boolean;
  taskId?: number;
}

/**
 * 指定期間のイベントを取得
 */
export async function getEventsForRange(startDate: Date, endDate: Date) {
  log.info({ startDate, endDate }, 'Fetching events for range');

  const events = await prisma.scheduleEvent.findMany({
    where: {
      OR: [
        { startAt: { gte: startDate, lte: endDate } },
        { endAt: { gte: startDate, lte: endDate } },
        { startAt: { lte: startDate }, endAt: { gte: endDate } },
      ],
    },
    // @ts-expect-error task relation not yet defined in Prisma schema (taskId field exists)
    include: { task: { select: { id: true, title: true, status: true } } },
    orderBy: { startAt: 'asc' },
  });

  return events;
}

/**
 * イベントを作成
 */
export async function createEvent(input: CalendarEventInput) {
  const conflicts = await checkConflicts(input.startAt, input.endAt);
  if (conflicts.length > 0) {
    log.warn({ conflicts: conflicts.length }, 'Event has time conflicts');
  }

  const event = await prisma.scheduleEvent.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      startAt: input.startAt,
      endAt: input.endAt,
      isAllDay: input.allDay ?? false,
      taskId: input.taskId ?? null,
    },
    // @ts-expect-error task relation not yet defined in Prisma schema (taskId field exists)
    include: { task: { select: { id: true, title: true, status: true } } },
  });

  log.info({ eventId: event.id }, 'Calendar event created');
  return { event, conflicts };
}

/**
 * 指定時間帯に重複するイベントがないかチェック
 */
export async function checkConflicts(startAt: Date, endAt: Date, excludeEventId?: number) {
  const where: Record<string, unknown> = {
    AND: [{ startAt: { lt: endAt } }, { endAt: { gt: startAt } }, { allDay: false }],
  };

  if (excludeEventId) {
    (where.AND as Array<Record<string, unknown>>).push({ id: { not: excludeEventId } });
  }

  const conflicts = await prisma.scheduleEvent.findMany({
    where,
    select: { id: true, title: true, startAt: true, endAt: true },
    orderBy: { startAt: 'asc' },
  });

  return conflicts;
}
