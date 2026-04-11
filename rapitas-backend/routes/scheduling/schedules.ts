/**
 * Schedule Events API Routes
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/error-handler';
import {
  parseRRule,
  expandRecurrence,
  RECURRENCE_PRESETS,
} from '../../services/scheduling/recurrence-service';
import { createLogger } from '../../config/logger';
import { realtimeService } from '../../services/communication/realtime-service';
import { syncCalendarToTask } from '../../services/scheduling/task-calendar-sync';

const log = createLogger('routes:schedules');

export const schedulesRoutes = new Elysia({ prefix: '/schedules' })
  // Get all schedule events (with optional date range filter)
  // Expands recurring events into virtual instances
  .get('/', async (context) => {
    const { query } = context;
    const { from, to } = query as { from?: string; to?: string };

    const rangeStart = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rangeEnd = to ? new Date(to) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    // Fetch non-recurring events
    const where: Record<string, unknown> = {
      recurrenceRule: null,
      parentEventId: null,
    };
    if (from || to) {
      where.startAt = {};
      if (from) (where.startAt as Record<string, unknown>).gte = new Date(from);
      if (to) (where.startAt as Record<string, unknown>).lte = new Date(to);
    }

    const normalEvents = await prisma.scheduleEvent.findMany({
      where,
      orderBy: { startAt: 'asc' },
    });

    // Fetch recurring event parents
    const recurringEvents = await prisma.scheduleEvent.findMany({
      where: {
        recurrenceRule: { not: null },
        parentEventId: null,
      },
    });

    // Fetch recurrence exceptions (individually edited instances)
    const exceptions = await prisma.scheduleEvent.findMany({
      where: {
        isRecurrenceException: true,
        startAt: { gte: rangeStart, lte: rangeEnd },
      },
    });

    const exceptionDates = new Set(
      exceptions.map((e) => `${e.parentEventId}:${e.originalDate?.toISOString().split('T')[0]}`),
    );

    // Expand recurring events into virtual instances
    const expandedEvents: typeof normalEvents = [];

    for (const event of recurringEvents) {
      if (!event.recurrenceRule) continue;

      try {
        const rule = parseRRule(event.recurrenceRule);
        const occurrences = expandRecurrence(
          event.startAt,
          rule,
          rangeStart,
          rangeEnd,
          event.recurrenceEnd,
        );

        for (const date of occurrences) {
          const dateKey = `${event.id}:${date.toISOString().split('T')[0]}`;

          // Skip if an exception instance exists (the exception replaces this occurrence)
          if (exceptionDates.has(dateKey)) continue;

          // Generate virtual instance
          const duration = event.endAt ? event.endAt.getTime() - event.startAt.getTime() : 0;

          expandedEvents.push({
            ...event,
            id: event.id * 10000 + (Math.floor(date.getTime() / 86400000) % 10000), // virtual ID
            startAt: date,
            endAt: duration > 0 ? new Date(date.getTime() + duration) : null,
            parentEventId: event.id,
          });
        }
      } catch (e) {
        log.error({ err: e }, `Failed to expand recurrence for event ${event.id}`);
      }
    }

    // Merge all events and sort by start time
    const allEvents = [...normalEvents, ...expandedEvents, ...exceptions].sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime(),
    );

    return allEvents;
  })

  // Recurrence presets list
  .get('/recurrence-presets', () => {
    return RECURRENCE_PRESETS;
  })

  // Get single schedule event
  .get('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('Invalid ID');

    const event = await prisma.scheduleEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundError('Schedule event not found');

    return event;
  })

  // Create schedule event
  .post('/', async (context) => {
    const { body } = context;
    const data = body as {
      title: string;
      description?: string;
      startAt: string;
      endAt?: string;
      isAllDay?: boolean;
      color?: string;
      reminderMinutes?: number | null;
      taskId?: number | null;
      type?: string;
      userId?: string;
      recurrenceRule?: string | null;
      recurrenceEnd?: string | null;
    };

    if (!data.title?.trim()) throw new ValidationError('Title is required');
    if (!data.startAt) throw new ValidationError('Start date/time is required');

    const event = await prisma.scheduleEvent.create({
      data: {
        title: data.title.trim(),
        description: data.description?.trim() || null,
        startAt: new Date(data.startAt),
        endAt: data.endAt ? new Date(data.endAt) : null,
        isAllDay: data.isAllDay ?? false,
        color: data.color || '#6366F1',
        reminderMinutes: data.reminderMinutes ?? null,
        taskId: data.taskId ?? null,
        type: data.type === 'PAID_LEAVE' ? 'PAID_LEAVE' : 'GENERAL',
        userId: data.userId || 'default',
        recurrenceRule: data.recurrenceRule || null,
        recurrenceEnd: data.recurrenceEnd ? new Date(data.recurrenceEnd) : null,
      },
    });

    // NOTE: Broadcast schedule creation for real-time calendar sync.
    realtimeService.broadcastAll('schedule_created', {
      eventId: event.id,
      title: event.title,
      startAt: event.startAt,
      timestamp: new Date().toISOString(),
    });

    return event;
  })

  // Update schedule event
  .patch('/:id', async (context) => {
    const { params, body } = context;
    const data_input = body as {
      title?: string;
      description?: string | null;
      startAt?: string;
      endAt?: string | null;
      isAllDay?: boolean;
      color?: string;
      reminderMinutes?: number | null;
      reminderSentAt?: string | null;
      taskId?: number | null;
      type?: string;
      userId?: string;
    };

    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('Invalid ID');

    const existing = await prisma.scheduleEvent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Schedule event not found');

    const data: Record<string, unknown> = {};
    if (data_input.title !== undefined) data.title = data_input.title.trim();
    if (data_input.description !== undefined) data.description = data_input.description;
    if (data_input.startAt !== undefined) data.startAt = new Date(data_input.startAt);
    if (data_input.endAt !== undefined)
      data.endAt = data_input.endAt ? new Date(data_input.endAt) : null;
    if (data_input.isAllDay !== undefined) data.isAllDay = data_input.isAllDay;
    if (data_input.color !== undefined) data.color = data_input.color;
    if (data_input.reminderMinutes !== undefined) data.reminderMinutes = data_input.reminderMinutes;
    if (data_input.reminderSentAt !== undefined)
      data.reminderSentAt = data_input.reminderSentAt ? new Date(data_input.reminderSentAt) : null;
    if (data_input.taskId !== undefined) data.taskId = data_input.taskId;

    const updated = await prisma.scheduleEvent.update({
      where: { id },
      data,
    });

    realtimeService.broadcastAll('schedule_updated', {
      eventId: id,
      title: updated.title,
      startAt: updated.startAt,
      timestamp: new Date().toISOString(),
    });

    // NOTE: Bidirectional sync — calendar date changes propagate back to linked task.
    if (data_input.startAt && updated.taskId) {
      syncCalendarToTask(id, new Date(data_input.startAt)).catch((err) => {
        log.warn({ err, eventId: id }, 'Calendar-to-task sync failed');
      });
    }

    return updated;
  })

  // Delete schedule event
  .delete('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('Invalid ID');

    const existing = await prisma.scheduleEvent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Schedule event not found');

    await prisma.scheduleEvent.delete({ where: { id } });

    realtimeService.broadcastAll('schedule_deleted', {
      eventId: id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, id };
  })

  // Edit a single instance of a recurring event (this occurrence only)
  .post('/:id/exception', async (context) => {
    const { params, body } = context;
    const parentId = parseInt(params.id);
    if (isNaN(parentId)) throw new ValidationError('Invalid ID');

    const data = body as {
      originalDate: string; // original recurrence date
      title?: string;
      description?: string;
      startAt?: string;
      endAt?: string;
      color?: string;
    };

    const parent = await prisma.scheduleEvent.findUnique({ where: { id: parentId } });
    if (!parent) throw new NotFoundError('Parent event not found');

    // Create exception instance
    return await prisma.scheduleEvent.create({
      data: {
        title: data.title || parent.title,
        description: data.description ?? parent.description,
        startAt: data.startAt ? new Date(data.startAt) : new Date(data.originalDate),
        endAt: data.endAt ? new Date(data.endAt) : parent.endAt,
        isAllDay: parent.isAllDay,
        color: data.color || parent.color,
        reminderMinutes: parent.reminderMinutes,
        taskId: parent.taskId,
        type: parent.type,
        userId: parent.userId,
        parentEventId: parentId,
        isRecurrenceException: true,
        originalDate: new Date(data.originalDate),
      },
    });
  })

  // Stop recurrence from a given date (updates recurrenceEnd)
  .post('/:id/stop-recurrence', async (context) => {
    const { params, body } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('Invalid ID');

    const data = body as { stopDate: string };

    return await prisma.scheduleEvent.update({
      where: { id },
      data: {
        recurrenceEnd: new Date(data.stopDate),
      },
    });
  })

  // Get upcoming reminders (events with unsent reminders that are due)
  .get('/reminders/pending', async () => {
    const now = new Date();

    const events = await prisma.scheduleEvent.findMany({
      where: {
        reminderMinutes: { not: null },
        reminderSentAt: null,
        startAt: { gt: now },
      },
      orderBy: { startAt: 'asc' },
    });

    // Filter events where reminder time has passed
    return events.filter((event: { startAt: Date; reminderMinutes: number | null }) => {
      const reminderTime = new Date(event.startAt.getTime() - event.reminderMinutes! * 60 * 1000);
      return reminderTime <= now;
    });
  })

  // Mark reminder as sent
  .post('/reminders/:id/sent', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('Invalid ID');

    return await prisma.scheduleEvent.update({
      where: { id },
      data: { reminderSentAt: new Date() },
    });
  });
