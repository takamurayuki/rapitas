/**
 * Reports & Export API Routes
 *
 * Weekly reports use batch queries instead of per-day loops to avoid N+1.
 * Export is bounded with take: 500 for safety.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config/database';

export const reportsRoutes = new Elysia()
  .get('/reports/weekly', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    // NOTE: Batch queries replace the previous 14-query N+1 loop.
    const [
      thisWeekTasks,
      lastWeekTasks,
      thisWeekTime,
      lastWeekTime,
      completedTasks,
      timeEntries,
      subjectData,
    ] = await Promise.all([
      prisma.task.count({
        where: { status: 'done', completedAt: { gte: weekAgo }, parentId: null },
      }),
      prisma.task.count({
        where: { status: 'done', completedAt: { gte: twoWeeksAgo, lt: weekAgo }, parentId: null },
      }),
      prisma.timeEntry.findMany({
        where: { startedAt: { gte: weekAgo } },
        select: { duration: true },
      }),
      prisma.timeEntry.findMany({
        where: { startedAt: { gte: twoWeeksAgo, lt: weekAgo } },
        select: { duration: true },
      }),
      // Daily breakdown: fetch all completed tasks in the week, group in JS
      prisma.task.findMany({
        where: { status: 'done', completedAt: { gte: weekAgo }, parentId: null },
        select: { completedAt: true },
      }),
      prisma.timeEntry.findMany({
        where: { startedAt: { gte: weekAgo } },
        select: { startedAt: true, duration: true },
      }),
      prisma.task.groupBy({
        by: ['subject'],
        where: { subject: { not: null }, completedAt: { gte: weekAgo } },
        _count: true,
      }),
    ]);

    const thisWeekHours = thisWeekTime.reduce((s, e) => s + e.duration, 0);
    const lastWeekHours = lastWeekTime.reduce((s, e) => s + e.duration, 0);

    // Build daily data from batch results (0 queries, pure JS grouping)
    const dailyData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const tasks = completedTasks.filter((t) => {
        if (!t.completedAt) return false;
        return t.completedAt.toISOString().split('T')[0] === dateStr;
      }).length;

      const hours = timeEntries
        .filter((e) => e.startedAt.toISOString().split('T')[0] === dateStr)
        .reduce((s, e) => s + e.duration, 0);

      dailyData.push({
        date: dateStr,
        tasks,
        hours: Math.round(hours * 10) / 10,
      });
    }

    return {
      period: { start: weekAgo.toISOString(), end: today.toISOString() },
      summary: {
        tasksCompleted: thisWeekTasks,
        studyHours: Math.round(thisWeekHours * 10) / 10,
        tasksChange: thisWeekTasks - lastWeekTasks,
        hoursChange: Math.round((thisWeekHours - lastWeekHours) * 10) / 10,
      },
      dailyData,
      subjectBreakdown: subjectData.map((s: { subject: string | null; _count: number }) => ({
        subject: s.subject,
        count: s._count,
      })),
    };
  })

  .get('/export/tasks', async () => {
    const tasks = await prisma.task.findMany({
      where: { parentId: null },
      include: {
        subtasks: true,
        theme: true,
        taskLabels: { include: { label: true } },
        timeEntries: true,
      },
      take: 500,
      orderBy: { updatedAt: 'desc' },
    });

    return {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      tasks: tasks.map((t: (typeof tasks)[number]) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        subject: t.subject,
        estimatedHours: t.estimatedHours,
        actualHours: t.actualHours,
        theme: t.theme?.name,
        labels: t.taskLabels.map((tl: { label: { name: string } }) => tl.label.name),
        subtasks: t.subtasks.map((st: { title: string; status: string }) => ({
          title: st.title,
          status: st.status,
        })),
        totalTimeHours: t.timeEntries.reduce(
          (sum: number, e: { duration: number }) => sum + e.duration,
          0,
        ),
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
    };
  });
