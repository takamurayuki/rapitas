/**
 * Habits API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { checkAchievements } from "../../services/achievement-checker";

/**
 * ストリーク計算ロジック
 */
function calculateStreak(
  logs: { date: Date; count: number }[],
  frequency: string = "daily"
): { current: number; longest: number; lastDate: Date | null; totalCompletions: number } {
  if (logs.length === 0) {
    return { current: 0, longest: 0, lastDate: null, totalCompletions: 0 };
  }

  // 日付でソート（降順）
  const sortedLogs = [...logs]
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const totalCompletions = sortedLogs.reduce((sum, log) => sum + log.count, 0);
  const lastDate = sortedLogs[0]!.date;

  // ユニークな日付セット（日単位）
  const dateSet = new Set<string>();
  for (const log of sortedLogs) {
    if (log.count > 0) {
      const dateKey = log.date.toISOString().split("T")[0]!;
      dateSet.add(dateKey);
    }
  }

  const dates = Array.from(dateSet).sort().reverse();

  if (dates.length === 0) {
    return { current: 0, longest: 0, lastDate, totalCompletions };
  }

  // 現在のストリーク計算（今日または昨日から開始）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayStr = today.toISOString().split("T")[0]!;
  const yesterdayStr = yesterday.toISOString().split("T")[0]!;

  let current = 0;
  const startFromToday = dates[0] === todayStr;
  const startFromYesterday = dates[0] === yesterdayStr;

  if (startFromToday || startFromYesterday) {
    const startDate = startFromToday ? today : yesterday;
    for (let i = 0; i < dates.length; i++) {
      const expected = new Date(startDate);
      expected.setDate(expected.getDate() - i);
      const expectedStr = expected.toISOString().split("T")[0]!;

      if (dates[i] === expectedStr) {
        current++;
      } else {
        break;
      }
    }
  }

  // 最長ストリーク計算
  let longest = 0;
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prevDate = new Date(dates[i - 1]!);
    const currDate = new Date(dates[i]!);
    const diffDays = Math.round(
      (prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 1) {
      streak++;
    } else {
      longest = Math.max(longest, streak);
      streak = 1;
    }
  }
  longest = Math.max(longest, streak, current);

  return { current, longest, lastDate, totalCompletions };
}

export const habitsRoutes = new Elysia({ prefix: "/habits" })
  .get("/", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await prisma.habit.findMany({
      include: {
        logs: {
          where: { date: today },
        },
        _count: { select: { logs: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  .get("/:id", async (context: any) => {
    const { params } = context;
    const id = parseInt(params.id);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const habit = await prisma.habit.findUnique({
      where: { id },
      include: {
        logs: {
          where: { date: { gte: thirtyDaysAgo } },
          orderBy: { date: "desc" },
        },
      },
    });

    if (!habit) return null;

    // ストリーク計算
    const allLogs = await prisma.habitLog.findMany({
      where: { habitId: id },
      orderBy: { date: "desc" },
    });

    const streak = calculateStreak(allLogs, habit.frequency);

    // 週次達成率（直近4週間）
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const recentLogs = allLogs.filter((l) => l.date >= fourWeeksAgo);
    const completionRate = recentLogs.length > 0
      ? Math.round((recentLogs.length / 28) * 100)
      : 0;

    return {
      ...habit,
      streak,
      completionRate,
    };
  })

  // 全習慣のストリーク情報を一括取得
  .get("/streaks/all", async () => {
    const habits = await prisma.habit.findMany({
      where: { isActive: true },
      include: {
        logs: {
          orderBy: { date: "desc" },
        },
      },
    });

    return habits.map((habit) => {
      const streak = calculateStreak(habit.logs, habit.frequency);
      return {
        id: habit.id,
        name: habit.name,
        icon: habit.icon,
        color: habit.color,
        ...streak,
      };
    });
  })

  .post(
    "/",
    async ({ body }) => {
      const { name, description, icon, color, frequency, targetCount } =
        body as any;
      return await prisma.habit.create({
        data: {
          name,
          ...(description && { description }),
          ...(icon && { icon }),
          ...(color && { color }),
          ...(frequency && { frequency }),
          ...(targetCount && { targetCount }),
        },
      });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        color: t.Optional(t.String()),
        frequency: t.Optional(t.String()),
        targetCount: t.Optional(t.Number()),
      }),
    },
  )

  .patch("/:id", async ({ params, body }) => {
    const id = parseInt(params.id);
    const { name, description, icon, color, frequency, targetCount, isActive } =
      body as any;
    return await prisma.habit.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(icon !== undefined && { icon }),
        ...(color && { color }),
        ...(frequency && { frequency }),
        ...(targetCount && { targetCount }),
        ...(isActive !== undefined && { isActive }),
      },
    });
  })

  .delete("/:id", async (context: any) => {
    const { params } = context;
    const id = parseInt(params.id);
    return await prisma.habit.delete({ where: { id } });
  })

  .post("/:id/log", async ({ params, body }) => {
    const id = parseInt(params.id);
    const { date, note } = body as any;

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const log = await prisma.habitLog.upsert({
      where: {
        habitId_date: {
          habitId: id,
          date: targetDate,
        },
      },
      update: {
        count: { increment: 1 },
        ...(note && { note }),
      },
      create: {
        habitId: id,
        date: targetDate,
        count: 1,
        ...(note && { note }),
      },
    });

    // 実績チェック（非同期）
    checkAchievements("streak.updated").catch(() => {});

    return log;
  })

  // 習慣の統計情報
  .get("/:id/statistics", async (context: any) => {
    const { params } = context;
    const id = parseInt(params.id);

    const habit = await prisma.habit.findUnique({
      where: { id },
    });

    if (!habit) return { error: "Habit not found" };

    const allLogs = await prisma.habitLog.findMany({
      where: { habitId: id },
      orderBy: { date: "desc" },
    });

    const streak = calculateStreak(allLogs, habit.frequency);

    // 月別集計
    const monthlyMap = new Map<string, number>();
    for (const log of allLogs) {
      const monthKey = log.date.toISOString().slice(0, 7); // YYYY-MM
      monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + log.count);
    }

    const monthlyStats = Array.from(monthlyMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 6);

    // 曜日別集計
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    for (const log of allLogs) {
      dayOfWeekCounts[log.date.getDay()] += log.count;
    }

    return {
      ...streak,
      monthlyStats,
      dayOfWeekCounts,
      totalDays: allLogs.length,
    };
  });
