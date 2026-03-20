/**
 * Study Streak Service
 * Tracks study streaks (consecutive study days) and calculates bonus points.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('study-streak-service');

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastStudyDate: string | null;
}

/**
 * Get the current streak information.
 */
export async function getStreak(): Promise<StreakInfo> {
  const sessions = await prisma.pomodoroSession.findMany({
    where: { status: 'completed', type: 'work' },
    select: { completedAt: true },
    orderBy: { completedAt: 'desc' },
  });

  if (sessions.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastStudyDate: null };
  }

  // Group by day
  const studyDates = new Set(
    sessions.map((s) => (s.completedAt ?? new Date()).toISOString().split('T')[0]!),
  );
  const sortedDates = Array.from(studyDates).sort().reverse();
  const lastStudyDate = sortedDates[0] ?? null;

  // Check if streak continues from today or yesterday
  const today = new Date().toISOString().split('T')[0]!;
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;

  let currentStreak = 0;
  if (lastStudyDate === today || lastStudyDate === yesterday) {
    let checkDate = new Date(lastStudyDate);
    while (studyDates.has(checkDate.toISOString().split('T')[0]!)) {
      currentStreak++;
      checkDate = new Date(checkDate.getTime() - 86400000);
    }
  }

  // Calculate longest streak
  let longestStreak = 0;
  let streak = 1;
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const curr = new Date(sortedDates[i]!).getTime();
    const next = new Date(sortedDates[i + 1]!).getTime();
    if (curr - next === 86400000) {
      streak++;
    } else {
      longestStreak = Math.max(longestStreak, streak);
      streak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, streak, currentStreak);

  log.info({ currentStreak, longestStreak }, 'Streak calculated');
  return { currentStreak, longestStreak, lastStudyDate };
}

/**
 * Calculate streak bonus points.
 */
export function calculateStreakBonus(streakDays: number): number {
  if (streakDays <= 0) return 0;
  if (streakDays >= 30) return 50;
  if (streakDays >= 14) return 30;
  if (streakDays >= 7) return 15;
  if (streakDays >= 3) return 5;
  return 1;
}
