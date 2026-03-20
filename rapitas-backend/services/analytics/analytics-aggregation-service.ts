/**
 * Analytics Aggregation Service
 * タスク統計の集約・生産性トレンド・週次レポート生成
 */
import { prisma } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('analytics-aggregation-service');

export interface TaskStats {
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  averageCompletionDays: number;
}

export interface ProductivityTrend {
  date: string;
  tasksCompleted: number;
  hoursWorked: number;
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  stats: TaskStats;
  trends: ProductivityTrend[];
  topCategories: { name: string; count: number }[];
}

/**
 * タスク統計を集約する
 */
export async function aggregateTaskStats(from?: Date, to?: Date): Promise<TaskStats> {
  log.info({ from, to }, 'Aggregating task stats');

  const where: Record<string, unknown> = {};
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as Record<string, Date>).gte = from;
    if (to) (where.createdAt as Record<string, Date>).lte = to;
  }

  const [totalTasks, completedTasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.count({ where: { ...where, status: 'done' } }),
  ]);

  const completedWithDates = await prisma.task.findMany({
    where: { ...where, status: 'done', completedAt: { not: null } },
    select: { createdAt: true, completedAt: true },
  });

  let averageCompletionDays = 0;
  if (completedWithDates.length > 0) {
    const totalDays = completedWithDates.reduce((sum, t) => {
      const days = (t.completedAt!.getTime() - t.createdAt.getTime()) / 86400000;
      return sum + Math.max(0, days);
    }, 0);
    averageCompletionDays = Math.round((totalDays / completedWithDates.length) * 10) / 10;
  }

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return { totalTasks, completedTasks, completionRate, averageCompletionDays };
}

/**
 * 生産性トレンドを取得する（直近N日分）
 */
export async function getProductivityTrends(days = 14): Promise<ProductivityTrend[]> {
  log.info({ days }, 'Fetching productivity trends');

  const since = new Date();
  since.setDate(since.getDate() - days);

  const [tasks, timeEntries] = await Promise.all([
    prisma.task.findMany({
      where: { status: 'done', completedAt: { gte: since } },
      select: { completedAt: true },
    }),
    prisma.timeEntry.findMany({
      where: { startedAt: { gte: since } },
      select: { startedAt: true, duration: true },
    }),
  ]);

  const trendMap = new Map<string, ProductivityTrend>();

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    trendMap.set(dateStr, { date: dateStr, tasksCompleted: 0, hoursWorked: 0 });
  }

  for (const task of tasks) {
    if (!task.completedAt) continue;
    const dateStr = task.completedAt.toISOString().slice(0, 10);
    const entry = trendMap.get(dateStr);
    if (entry) entry.tasksCompleted++;
  }

  for (const te of timeEntries) {
    const dateStr = te.startedAt.toISOString().slice(0, 10);
    const entry = trendMap.get(dateStr);
    if (entry) entry.hoursWorked += te.duration ?? 0;
  }

  return Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 週次レポートを生成する
 */
export async function generateWeeklyReport(): Promise<WeeklyReport> {
  log.info('Generating weekly report');

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const [stats, trends, categoryData] = await Promise.all([
    aggregateTaskStats(weekStart, weekEnd),
    getProductivityTrends(7),
    prisma.task.findMany({
      where: { status: 'done', completedAt: { gte: weekStart, lte: weekEnd } },
      select: { theme: { select: { category: { select: { name: true } } } } },
    }),
  ]);

  const categoryCount = new Map<string, number>();
  for (const task of categoryData) {
    const name = task.theme?.category?.name ?? '未分類';
    categoryCount.set(name, (categoryCount.get(name) ?? 0) + 1);
  }

  const topCategories = Array.from(categoryCount.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: weekEnd.toISOString().slice(0, 10),
    stats,
    trends,
    topCategories,
  };
}
