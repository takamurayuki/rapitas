/**
 * Habit Tracking Service
 * 習慣の追跡・統計・ストリーク計算
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('habit-tracking-service');

export interface HabitStats {
  totalCompletions: number;
  currentStreak: number;
  longestStreak: number;
  completionRate: number;
}

/**
 * 習慣の統計情報を取得する
 */
export async function getHabitStats(habitId: number): Promise<HabitStats> {
  log.info({ habitId }, 'Fetching habit stats');

  // @ts-expect-error HabitCompletion model not yet defined in Prisma schema
  const completions = await prisma.habitCompletion.findMany({
    where: { habitId },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  });

  const totalCompletions = completions.length;
  if (totalCompletions === 0) {
    return { totalCompletions: 0, currentStreak: 0, longestStreak: 0, completionRate: 0 };
  }

  const { currentStreak, longestStreak } = calculateStreaks(
    completions.map((c: { completedAt: Date }) => c.completedAt),
  );

  const habit = await prisma.habit.findUnique({
    where: { id: habitId },
    select: { createdAt: true },
  });

  const daysSinceCreation = habit
    ? Math.max(1, Math.ceil((Date.now() - habit.createdAt.getTime()) / 86400000))
    : 1;
  const completionRate = Math.min(100, Math.round((totalCompletions / daysSinceCreation) * 100));

  return { totalCompletions, currentStreak, longestStreak, completionRate };
}

/**
 * 習慣の完了を記録する
 */
export async function recordHabitCompletion(habitId: number): Promise<{ id: number }> {
  log.info({ habitId }, 'Recording habit completion');

  // @ts-expect-error HabitCompletion model not yet defined in Prisma schema
  const completion = await prisma.habitCompletion.create({
    data: { habitId, completedAt: new Date() },
  });

  return { id: completion.id };
}

/**
 * 習慣の現在のストリークを取得する
 */
export async function getHabitStreak(habitId: number): Promise<number> {
  // @ts-expect-error HabitCompletion model not yet defined in Prisma schema
  const completions = await prisma.habitCompletion.findMany({
    where: { habitId },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  });

  return calculateStreaks(completions.map((c: { completedAt: Date }) => c.completedAt))
    .currentStreak;
}

function calculateStreaks(dates: Date[]): { currentStreak: number; longestStreak: number } {
  if (dates.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const uniqueDays = [...new Set(dates.map((d) => d.toISOString().slice(0, 10)))].sort().reverse();
  const today = new Date().toISOString().slice(0, 10);

  let currentStreak = 0;
  let longestStreak = 0;
  let streak = 1;

  if (uniqueDays[0] === today || uniqueDays[0] === getPreviousDay(today)) {
    currentStreak = 1;
  }

  for (let i = 1; i < uniqueDays.length; i++) {
    if (uniqueDays[i] === getPreviousDay(uniqueDays[i - 1]!)) {
      streak++;
      if (i < currentStreak + 1 || currentStreak > 0) currentStreak = streak;
    } else {
      longestStreak = Math.max(longestStreak, streak);
      streak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, streak);
  currentStreak = Math.min(currentStreak, longestStreak);

  return { currentStreak, longestStreak };
}

function getPreviousDay(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
