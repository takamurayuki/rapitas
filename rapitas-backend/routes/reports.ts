/**
 * Reports & Export API Routes
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";

export const reportsRoutes = new Elysia()
  // Weekly Report
  .get("/reports/weekly", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    // 今週のデータ
    const thisWeekTasks = await prisma.task.count({
      where: { status: "done", completedAt: { gte: weekAgo }, parentId: null },
    });
    const thisWeekTime = await prisma.timeEntry.findMany({
      where: { startedAt: { gte: weekAgo } },
    });
    const thisWeekHours = thisWeekTime.reduce(
      (sum: number, e: { duration: number }) => sum + e.duration,
      0
    );

    // 先週のデータ（比較用）
    const lastWeekTasks = await prisma.task.count({
      where: {
        status: "done",
        completedAt: { gte: twoWeeksAgo, lt: weekAgo },
        parentId: null,
      },
    });
    const lastWeekTime = await prisma.timeEntry.findMany({
      where: { startedAt: { gte: twoWeeksAgo, lt: weekAgo } },
    });
    const lastWeekHours = lastWeekTime.reduce(
      (sum: number, e: { duration: number }) => sum + e.duration,
      0
    );

    // 日別データ
    const dailyData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const tasks = await prisma.task.count({
        where: {
          status: "done",
          completedAt: { gte: date, lt: nextDate },
          parentId: null,
        },
      });
      const time = await prisma.timeEntry.findMany({
        where: { startedAt: { gte: date, lt: nextDate } },
      });
      const hours = time.reduce(
        (sum: number, e: { duration: number }) => sum + e.duration,
        0
      );

      dailyData.push({
        date: date.toISOString().split("T")[0],
        tasks,
        hours: Math.round(hours * 10) / 10,
      });
    }

    // 科目別データ
    const subjectData = await prisma.task.groupBy({
      by: ["subject"],
      where: {
        subject: { not: null },
        completedAt: { gte: weekAgo },
      },
      _count: true,
    });

    return {
      period: {
        start: weekAgo.toISOString(),
        end: today.toISOString(),
      },
      summary: {
        tasksCompleted: thisWeekTasks,
        studyHours: Math.round(thisWeekHours * 10) / 10,
        tasksChange: thisWeekTasks - lastWeekTasks,
        hoursChange: Math.round((thisWeekHours - lastWeekHours) * 10) / 10,
      },
      dailyData,
      subjectBreakdown: subjectData.map(
        (s: { subject: string | null; _count: number }) => ({
          subject: s.subject,
          count: s._count,
        })
      ),
    };
  })

  // Export Tasks
  .get("/export/tasks", async () => {
    const tasks = await prisma.task.findMany({
      where: { parentId: null },
      include: {
        subtasks: true,
        theme: true,
        taskLabels: { include: { label: true } },
        timeEntries: true,
      },
    });

    return {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      tasks: tasks.map((t) => ({
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
        labels: t.taskLabels.map((tl) => tl.label.name),
        subtasks: t.subtasks.map((st) => ({
          title: st.title,
          status: st.status,
        })),
        totalTimeHours: t.timeEntries.reduce(
          (sum: number, e: { duration: number }) => sum + e.duration,
          0
        ),
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
    };
  });
