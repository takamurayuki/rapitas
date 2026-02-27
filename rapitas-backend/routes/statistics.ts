/**
 * Dashboard Statistics API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";

export const statisticsRoutes = new Elysia({ prefix: "/statistics" })
  .get("/overview", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);

    // タスク統計
    const totalTasks = await prisma.task.count({ where: { parentId: null } });
    const completedTasks = await prisma.task.count({
      where: { parentId: null, status: "done" },
    });
    const todayCompleted = await prisma.task.count({
      where: {
        parentId: null,
        status: "done",
        completedAt: { gte: today },
      },
    });
    const weekCompleted = await prisma.task.count({
      where: {
        parentId: null,
        status: "done",
        completedAt: { gte: weekAgo },
      },
    });

    // 学習時間統計
    const weekTimeEntries = await prisma.timeEntry.findMany({
      where: { startedAt: { gte: weekAgo } },
    });
    const weekStudyHours = weekTimeEntries.reduce(
      (sum: number, entry: { duration: number }) => sum + entry.duration,
      0
    );

    const monthTimeEntries = await prisma.timeEntry.findMany({
      where: { startedAt: { gte: monthAgo } },
    });
    const monthStudyHours = monthTimeEntries.reduce(
      (sum: number, entry: { duration: number }) => sum + entry.duration,
      0
    );

    // 試験目標
    const upcomingExams = await prisma.examGoal.findMany({
      where: {
        examDate: { gte: today },
        isCompleted: false,
      },
      orderBy: { examDate: "asc" },
      take: 5,
    });

    // ストリーク
    const streakData = await prisma.studyStreak.findMany({
      where: { date: { gte: weekAgo } },
      orderBy: { date: "asc" },
    });

    return {
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        todayCompleted,
        weekCompleted,
        completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      },
      studyTime: {
        weekHours: Math.round(weekStudyHours * 10) / 10,
        monthHours: Math.round(monthStudyHours * 10) / 10,
      },
      upcomingExams,
      streakData,
    };
  })

  // 日別学習時間
  .get("/daily-study", async (context: any) => {
      const { query  } = context;
    const daysNum = query.days ? parseInt(query.days) : 7;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0);

    const timeEntries = await prisma.timeEntry.findMany({
      where: { startedAt: { gte: startDate } },
      orderBy: { startedAt: "asc" },
    });

    // 日別に集計
    const dailyData: Record<string, number> = {};
    for (let i = 0; i < daysNum; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];
      dailyData[String(dateStr)] = 0;
    }

    for (const entry of timeEntries) {
      const dateStr = entry.startedAt.toISOString().split("T")[0];
      if (dailyData[dateStr] !== undefined) {
        dailyData[dateStr] += entry.duration;
      }
    }

    return Object.entries(dailyData).map(([date, hours]) => ({
      date,
      hours: Math.round(hours * 10) / 10,
    }));
  })

  // 科目別学習時間
  .get("/subject-breakdown", async (context: any) => {
      const { query  } = context;
    const daysNum = query.days ? parseInt(query.days) : 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);

    const tasks = await prisma.task.findMany({
      where: {
        subject: { not: null },
        timeEntries: {
          some: {
            startedAt: { gte: startDate },
          },
        },
      },
      include: {
        timeEntries: {
          where: { startedAt: { gte: startDate } },
        },
      },
    });

    const subjectData: Record<string, number> = {};
    for (const task of tasks) {
      if (task.subject) {
        const hours = task.timeEntries.reduce(
          (sum: number, e: { duration: number }) => sum + e.duration,
          0
        );
        subjectData[task.subject] = (subjectData[task.subject] || 0) + hours;
      }
    }

    return Object.entries(subjectData)
      .map(([subject, hours]) => ({
        subject,
        hours: Math.round(hours * 10) / 10,
      }))
      .sort((a, b) => b.hours - a.hours);
  })

  // バーンダウンチャートデータ
  .get(
    "/burndown",
    async ({ 

      query,
    }: {
      query: { days?: string; themeId?: string; projectId?: string };
    }) => {
      const daysNum = query.days ? parseInt(query.days) : 14;
      const themeId = query.themeId ? parseInt(query.themeId) : undefined;
      const projectId = query.projectId ? parseInt(query.projectId) : undefined;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysNum);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);

      // フィルター条件を構築
      const whereBase = {
        parentId: null,
        ...(themeId && { themeId }),
        ...(projectId && { projectId }),
      };

      // 期間開始時点での総タスク数（期間開始前に作成された未完了タスク + 期間中に作成されたタスク）
      const tasksAtStart = await prisma.task.count({
        where: {
          ...whereBase,
          createdAt: { lte: startDate },
          OR: [
            { status: { not: "done" } },
            { completedAt: { gt: startDate } },
          ],
        },
      });

      // 期間中に作成されたタスク
      const tasksCreatedInPeriod = await prisma.task.findMany({
        where: {
          ...whereBase,
          createdAt: { gt: startDate, lte: endDate },
        },
        select: { id: true, createdAt: true },
      });

      // 期間中に完了したタスク
      const tasksCompletedInPeriod = await prisma.task.findMany({
        where: {
          ...whereBase,
          status: "done",
          completedAt: { gte: startDate, lte: endDate },
        },
        select: { id: true, completedAt: true },
      });

      // 日別データを構築
      const dailyData: {
        date: string;
        remaining: number;
        ideal: number;
        completed: number;
        added: number;
      }[] = [];

      let totalTasks = tasksAtStart;
      const initialTotal = tasksAtStart + tasksCreatedInPeriod.length;
      let remainingTasks = totalTasks;

      for (let i = 0; i <= daysNum; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split("T")[0];

        // この日に追加されたタスク数
        const addedToday = tasksCreatedInPeriod.filter((t: typeof tasksCreatedInPeriod[number]) => {
          const created = t.createdAt.toISOString().split("T")[0];
          return created === dateStr;
        }).length;

        // この日に完了したタスク数
        const completedToday = tasksCompletedInPeriod.filter((t: typeof tasksCompletedInPeriod[number]) => {
          if (!t.completedAt) return false;
          const completed = t.completedAt.toISOString().split("T")[0];
          return completed === dateStr;
        }).length;

        totalTasks += addedToday;
        remainingTasks = remainingTasks + addedToday - completedToday;

        // 理想線（初日から最終日まで線形減少）
        const idealRemaining = Math.max(
          0,
          initialTotal - (initialTotal / daysNum) * i
        );

        dailyData.push({
          date: dateStr,
          remaining: Math.max(0, remainingTasks),
          ideal: Math.round(idealRemaining * 10) / 10,
          completed: completedToday,
          added: addedToday,
        });
      }

      // 集計情報
      const totalCompleted = tasksCompletedInPeriod.length;
      const totalAdded = tasksCreatedInPeriod.length;
      const currentRemaining = remainingTasks;

      return {
        period: {
          start: startDate.toISOString().split("T")[0],
          end: endDate.toISOString().split("T")[0],
          days: daysNum,
        },
        summary: {
          initialTasks: tasksAtStart,
          totalAdded,
          totalCompleted,
          currentRemaining,
          velocity: Math.round((totalCompleted / daysNum) * 10) / 10,
        },
        dailyData,
      };
    },
    {
      query: t.Object({
        days: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
      }),
    }
  )

  // バーンアップチャートデータ
  .get(
    "/burnup",
    async ({
      query,
    }: {
      query: { days?: string; themeId?: string; projectId?: string };
    }) => {
      const daysNum = query.days ? parseInt(query.days) : 14;
      const themeId = query.themeId ? parseInt(query.themeId) : undefined;
      const projectId = query.projectId ? parseInt(query.projectId) : undefined;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysNum);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);

      // フィルター条件を構築
      const whereBase = {
        parentId: null,
        ...(themeId && { themeId }),
        ...(projectId && { projectId }),
      };

      // 期間中に完了したタスク
      const tasksCompletedInPeriod = await prisma.task.findMany({
        where: {
          ...whereBase,
          status: "done",
          completedAt: { gte: startDate, lte: endDate },
        },
        select: { id: true, completedAt: true },
        orderBy: { completedAt: "asc" },
      });

      // 期間中に作成されたタスク
      const tasksCreatedInPeriod = await prisma.task.findMany({
        where: {
          ...whereBase,
          createdAt: { gt: startDate, lte: endDate },
        },
        select: { id: true, createdAt: true },
      });

      // 現在の残りタスク数
      const currentRemaining = await prisma.task.count({
        where: {
          ...whereBase,
          status: { not: "done" },
        },
      });

      // 日別データを構築
      const dailyData: {
        date: string;
        completed: number; // その日の完了数
        cumulativeCompleted: number; // 累積完了数
        added: number; // その日の追加数
      }[] = [];

      let cumulativeCompleted = 0;

      for (let i = 0; i <= daysNum; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split("T")[0];

        // この日に完了したタスク数
        const completedToday = tasksCompletedInPeriod.filter((t: typeof tasksCompletedInPeriod[number]) => {
          if (!t.completedAt) return false;
          const completed = t.completedAt.toISOString().split("T")[0];
          return completed === dateStr;
        }).length;

        // この日に追加されたタスク数
        const addedToday = tasksCreatedInPeriod.filter((t: typeof tasksCreatedInPeriod[number]) => {
          const created = t.createdAt.toISOString().split("T")[0];
          return created === dateStr;
        }).length;

        cumulativeCompleted += completedToday;

        dailyData.push({
          date: dateStr,
          completed: completedToday,
          cumulativeCompleted,
          added: addedToday,
        });
      }

      // 集計情報
      const totalCompleted = tasksCompletedInPeriod.length;
      const totalAdded = tasksCreatedInPeriod.length;

      return {
        period: {
          start: startDate.toISOString().split("T")[0],
          end: endDate.toISOString().split("T")[0],
          days: daysNum,
        },
        summary: {
          totalCompleted,
          totalAdded,
          currentRemaining,
          velocity: Math.round((totalCompleted / daysNum) * 10) / 10,
          cumulativeCompleted,
        },
        dailyData,
      };
    },
    {
      query: t.Object({
        days: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
      }),
    }
  );
