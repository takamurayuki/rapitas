/**
 * Export Routes
 *
 * HTTP routes for exporting user data in various formats (JSON, CSV).
 * Supports exporting tasks, projects, labels, and other user data.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:export');

/**
 * Formats a date for CSV output
 */
function formatDateForCSV(date: Date | null): string {
  if (!date) return '';
  return date.toISOString();
}

/**
 * Escapes a string value for CSV format
 */
function escapeCSV(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts tasks array to CSV format
 */
function tasksToCSV(
  tasks: Array<{
    id: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    dueDate: Date | null;
    estimatedHours: number | null;
    actualHours: number | null;
    createdAt: Date;
    updatedAt: Date;
    parentId: number | null;
    projectId: number | null;
    project?: { name: string } | null;
    labels: unknown;
  }>,
): string {
  const headers = [
    'id',
    'title',
    'description',
    'status',
    'priority',
    'dueDate',
    'estimatedHours',
    'actualHours',
    'projectName',
    'labels',
    'parentId',
    'createdAt',
    'updatedAt',
  ];

  const rows = tasks.map((task) => [
    task.id,
    escapeCSV(task.title),
    escapeCSV(task.description),
    task.status,
    task.priority,
    formatDateForCSV(task.dueDate),
    task.estimatedHours ?? '',
    task.actualHours ?? '',
    escapeCSV(task.project?.name),
    escapeCSV(JSON.stringify(task.labels ?? [])),
    task.parentId ?? '',
    formatDateForCSV(task.createdAt),
    formatDateForCSV(task.updatedAt),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

export const exportRoutes = new Elysia({ prefix: '/export' })
  /**
   * Export all tasks as JSON
   */
  .get(
    '/tasks/json',
    async ({ query }) => {
      const { includeCompleted, projectId, themeId, categoryId } = query;

      const where: {
        status?: { not: string };
        projectId?: number;
        themeId?: number;
        theme?: { categoryId: number };
      } = {};

      if (!includeCompleted) {
        where.status = { not: 'completed' };
      }
      if (projectId) {
        where.projectId = projectId;
      }
      if (themeId) {
        where.themeId = themeId;
      }
      if (categoryId) {
        where.theme = { categoryId };
      }

      const tasks = await prisma.task.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          milestone: { select: { id: true, name: true } },
          theme: { select: { id: true, name: true } },
          parent: { select: { id: true, title: true } },
          subtasks: { select: { id: true, title: true, status: true } },
          timeEntries: {
            select: {
              id: true,
              duration: true,
              startedAt: true,
              endedAt: true,
            },
          },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      });

      log.info(`Exported ${tasks.length} tasks as JSON`);

      return {
        exportedAt: new Date().toISOString(),
        totalCount: tasks.length,
        filters: { includeCompleted, projectId, themeId, categoryId },
        tasks,
      };
    },
    {
      query: t.Object({
        includeCompleted: t.Optional(t.Boolean({ default: false })),
        projectId: t.Optional(t.Numeric()),
        themeId: t.Optional(t.Numeric()),
        categoryId: t.Optional(t.Numeric()),
      }),
    },
  )

  /**
   * Export all tasks as CSV
   */
  .get(
    '/tasks/csv',
    async ({ query, set }) => {
      const { includeCompleted, projectId, themeId, categoryId } = query;

      const where: {
        status?: { not: string };
        projectId?: number;
        themeId?: number;
        theme?: { categoryId: number };
      } = {};

      if (!includeCompleted) {
        where.status = { not: 'completed' };
      }
      if (projectId) {
        where.projectId = projectId;
      }
      if (themeId) {
        where.themeId = themeId;
      }
      if (categoryId) {
        where.theme = { categoryId };
      }

      const tasks = await prisma.task.findMany({
        where,
        include: {
          project: { select: { name: true } },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      });

      const csv = tasksToCSV(tasks);

      log.info(`Exported ${tasks.length} tasks as CSV`);

      set.headers['Content-Type'] = 'text/csv; charset=utf-8';
      set.headers['Content-Disposition'] =
        `attachment; filename="rapitas-tasks-${new Date().toISOString().split('T')[0]}.csv"`;

      return csv;
    },
    {
      query: t.Object({
        includeCompleted: t.Optional(t.Boolean({ default: false })),
        projectId: t.Optional(t.Numeric()),
        themeId: t.Optional(t.Numeric()),
        categoryId: t.Optional(t.Numeric()),
      }),
    },
  )

  /**
   * Export full backup (all data) as JSON
   */
  .get('/backup', async () => {
    const [
      tasks,
      projects,
      milestones,
      labels,
      categories,
      themes,
      habits,
      habitLogs,
      flashcardDecks,
      flashcards,
      examGoals,
      learningGoals,
      studyStreaks,
      scheduleEvents,
      timeEntries,
      pomodoroSessions,
    ] = await Promise.all([
      prisma.task.findMany({
        include: {
          timeEntries: true,
          comments: true,
        },
      }),
      prisma.project.findMany(),
      prisma.milestone.findMany(),
      prisma.label.findMany(),
      prisma.category.findMany(),
      prisma.theme.findMany(),
      prisma.habit.findMany(),
      prisma.habitLog.findMany(),
      prisma.flashcardDeck.findMany(),
      prisma.flashcard.findMany(),
      prisma.examGoal.findMany(),
      prisma.learningGoal.findMany(),
      prisma.studyStreak.findMany(),
      prisma.scheduleEvent.findMany(),
      prisma.timeEntry.findMany(),
      prisma.pomodoroSession.findMany(),
    ]);

    log.info('Full backup exported');

    return {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      counts: {
        tasks: tasks.length,
        projects: projects.length,
        milestones: milestones.length,
        labels: labels.length,
        categories: categories.length,
        themes: themes.length,
        habits: habits.length,
        habitLogs: habitLogs.length,
        flashcardDecks: flashcardDecks.length,
        flashcards: flashcards.length,
        examGoals: examGoals.length,
        learningGoals: learningGoals.length,
        studyStreaks: studyStreaks.length,
        scheduleEvents: scheduleEvents.length,
        timeEntries: timeEntries.length,
        pomodoroSessions: pomodoroSessions.length,
      },
      data: {
        tasks,
        projects,
        milestones,
        labels,
        categories,
        themes,
        habits,
        habitLogs,
        flashcardDecks,
        flashcards,
        examGoals,
        learningGoals,
        studyStreaks,
        scheduleEvents,
        timeEntries,
        pomodoroSessions,
      },
    };
  })

  /**
   * Export tasks and schedule events as iCalendar (.ics) format
   * Compatible with Google Calendar, Outlook, Apple Calendar, etc.
   */
  .get(
    '/calendar/ical',
    async ({ query, set }) => {
      const { includeCompleted, includeTasks, includeEvents } = query;

      const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Rapitas//Task Manager//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Rapitas Tasks',
        'X-WR-TIMEZONE:Asia/Tokyo',
      ];

      // Export tasks with due dates as VTODO
      if (includeTasks !== false) {
        const taskWhere: { status?: { not: string }; dueDate?: { not: null } } = {
          dueDate: { not: null },
        };
        if (!includeCompleted) {
          taskWhere.status = { not: 'completed' };
        }

        const tasks = await prisma.task.findMany({
          where: taskWhere,
          include: { project: { select: { name: true } } },
        });

        for (const task of tasks) {
          const uid = `task-${task.id}@rapitas.local`;
          const dtstamp = formatICalDate(task.updatedAt);
          const due = task.dueDate ? formatICalDate(task.dueDate) : '';
          const created = formatICalDate(task.createdAt);
          const summary = escapeICalText(task.title);
          const description = escapeICalText(task.description || '');
          const priority = mapPriorityToIcal(task.priority);
          const status = mapStatusToIcal(task.status);
          const categories = task.project?.name ? escapeICalText(task.project.name) : '';

          lines.push('BEGIN:VTODO');
          lines.push(`UID:${uid}`);
          lines.push(`DTSTAMP:${dtstamp}`);
          lines.push(`CREATED:${created}`);
          if (due) lines.push(`DUE:${due}`);
          lines.push(`SUMMARY:${summary}`);
          if (description) lines.push(`DESCRIPTION:${description}`);
          lines.push(`PRIORITY:${priority}`);
          lines.push(`STATUS:${status}`);
          if (categories) lines.push(`CATEGORIES:${categories}`);
          lines.push('END:VTODO');
        }

        log.info(`Exported ${tasks.length} tasks to iCal`);
      }

      // Export schedule events as VEVENT
      if (includeEvents !== false) {
        const events = await prisma.scheduleEvent.findMany({
          where: {
            startAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
          },
        });

        for (const event of events) {
          const uid = `event-${event.id}@rapitas.local`;
          const dtstamp = formatICalDate(event.updatedAt);
          const dtstart = formatICalDateTime(event.startAt);
          const dtend = event.endAt ? formatICalDateTime(event.endAt) : dtstart;
          const summary = escapeICalText(event.title);
          const description = escapeICalText(event.description || '');

          lines.push('BEGIN:VEVENT');
          lines.push(`UID:${uid}`);
          lines.push(`DTSTAMP:${dtstamp}`);
          lines.push(`DTSTART:${dtstart}`);
          lines.push(`DTEND:${dtend}`);
          lines.push(`SUMMARY:${summary}`);
          if (description) lines.push(`DESCRIPTION:${description}`);
          if (event.recurrenceRule) lines.push(`RRULE:${event.recurrenceRule}`);
          lines.push('END:VEVENT');
        }

        log.info(`Exported ${events.length} events to iCal`);
      }

      lines.push('END:VCALENDAR');

      const ical = lines.join('\r\n');

      set.headers['Content-Type'] = 'text/calendar; charset=utf-8';
      set.headers['Content-Disposition'] =
        `attachment; filename="rapitas-calendar-${new Date().toISOString().split('T')[0]}.ics"`;

      return ical;
    },
    {
      query: t.Object({
        includeCompleted: t.Optional(t.Boolean({ default: false })),
        includeTasks: t.Optional(t.Boolean({ default: true })),
        includeEvents: t.Optional(t.Boolean({ default: true })),
      }),
    },
  );

/**
 * Format date for iCal (DATE format: YYYYMMDD)
 */
function formatICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Format datetime for iCal (DATETIME format: YYYYMMDDTHHMMSSZ)
 */
function formatICalDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Escape text for iCal format
 */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Map Rapitas priority to iCal priority (1-9, 1=high, 9=low)
 */
function mapPriorityToIcal(priority: string): number {
  switch (priority) {
    case 'urgent':
      return 1;
    case 'high':
      return 3;
    case 'medium':
      return 5;
    case 'low':
      return 9;
    default:
      return 5;
  }
}

/**
 * Map Rapitas status to iCal status
 */
function mapStatusToIcal(status: string): string {
  switch (status) {
    case 'todo':
      return 'NEEDS-ACTION';
    case 'in_progress':
    case 'progress':
      return 'IN-PROCESS';
    case 'completed':
      return 'COMPLETED';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return 'NEEDS-ACTION';
  }
}
