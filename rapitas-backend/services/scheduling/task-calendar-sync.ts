/**
 * Task-Calendar Bidirectional Sync
 *
 * Keeps tasks and calendar events in sync:
 *   - When a task's dueDate changes → create or update a linked calendar event
 *   - When a calendar event's date changes → update the linked task's dueDate
 *
 * The link is maintained via ScheduleEvent.taskId foreign key.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config';
import { realtimeService } from '../communication/realtime-service';

const log = createLogger('scheduling:task-calendar-sync');

/**
 * Sync a task's dueDate to its linked calendar event.
 *
 * Creates a new calendar event if one doesn't exist, or updates the existing one.
 * Called after task updates when dueDate changes.
 *
 * @param taskId - Task ID to sync. / 同期するタスクID
 * @param dueDate - New due date, or null to remove the event. / 新しい期限日、nullでイベント削除
 * @param taskTitle - Task title for the calendar event. / カレンダーイベント用のタスクタイトル
 */
export async function syncTaskToCalendar(
  taskId: number,
  dueDate: Date | null,
  taskTitle: string,
): Promise<void> {
  try {
    // Find existing calendar event linked to this task
    const existingEvent = await prisma.scheduleEvent.findFirst({
      where: { taskId },
    });

    if (!dueDate) {
      // Remove calendar event if dueDate is cleared
      if (existingEvent) {
        await prisma.scheduleEvent.delete({ where: { id: existingEvent.id } });
        realtimeService.broadcastAll('schedule_deleted', {
          eventId: existingEvent.id,
          timestamp: new Date().toISOString(),
        });
        log.debug({ taskId }, 'Calendar event removed (dueDate cleared)');
      }
      return;
    }

    if (existingEvent) {
      // Update existing event
      const updated = await prisma.scheduleEvent.update({
        where: { id: existingEvent.id },
        data: {
          title: taskTitle,
          startAt: dueDate,
          endAt: dueDate,
          isAllDay: true,
        },
      });
      realtimeService.broadcastAll('schedule_updated', {
        eventId: updated.id,
        title: updated.title,
        startAt: updated.startAt,
        timestamp: new Date().toISOString(),
      });
      log.debug({ taskId, eventId: existingEvent.id }, 'Calendar event updated from task');
    } else {
      // Create new event
      const created = await prisma.scheduleEvent.create({
        data: {
          title: `📋 ${taskTitle}`,
          startAt: dueDate,
          endAt: dueDate,
          isAllDay: true,
          color: '#6366F1',
          taskId,
          type: 'GENERAL',
          userId: 'default',
        },
      });
      realtimeService.broadcastAll('schedule_created', {
        eventId: created.id,
        title: created.title,
        startAt: created.startAt,
        timestamp: new Date().toISOString(),
      });
      log.debug({ taskId, eventId: created.id }, 'Calendar event created from task');
    }
  } catch (error) {
    // NOTE: Sync failure should not block the task update — degrade gracefully.
    log.warn({ err: error, taskId }, 'Task-to-calendar sync failed');
  }
}

/**
 * Sync a calendar event's date change back to its linked task.
 *
 * Updates the task's dueDate when a calendar event is moved.
 * Called after calendar event updates when startAt changes.
 *
 * @param eventId - Calendar event ID. / カレンダーイベントID
 * @param newStartAt - New start date. / 新しい開始日
 */
export async function syncCalendarToTask(eventId: number, newStartAt: Date): Promise<void> {
  try {
    const event = await prisma.scheduleEvent.findUnique({
      where: { id: eventId },
      select: { taskId: true },
    });

    if (!event?.taskId) return;

    await prisma.task.update({
      where: { id: event.taskId },
      data: { dueDate: newStartAt },
    });

    realtimeService.sendTaskUpdate(event.taskId, 'task_updated', {
      taskId: event.taskId,
      dueDate: newStartAt.toISOString(),
      timestamp: new Date().toISOString(),
    });

    log.debug({ eventId, taskId: event.taskId }, 'Task dueDate updated from calendar');
  } catch (error) {
    log.warn({ err: error, eventId }, 'Calendar-to-task sync failed');
  }
}
