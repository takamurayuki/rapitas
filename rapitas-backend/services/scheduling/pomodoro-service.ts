/**
 * Pomodoro Service
 *
 * Business logic for the pomodoro timer.
 */
import { prisma } from '../../config/database';

// Default settings
const WORK_DURATION = 25 * 60; // 25 minutes
const SHORT_BREAK_DURATION = 5 * 60; // 5 minutes
const LONG_BREAK_DURATION = 15 * 60; // 15 minutes
const POMODOROS_BEFORE_LONG_BREAK = 4;

export type PomodoroStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type PomodoroType = 'work' | 'short_break' | 'long_break';

/**
 * Get the active session (calculates current elapsed time).
 */
export async function getActiveSession() {
  const session = await prisma.pomodoroSession.findFirst({
    where: { status: { in: ['active', 'paused'] } },
    include: { task: { select: { id: true, title: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });

  if (!session) return null;

  // If active, calculate current elapsed time
  const currentElapsed =
    session.status === 'active'
      ? session.elapsed + Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
      : session.elapsed;

  return {
    ...session,
    currentElapsed: Math.min(currentElapsed, session.duration),
    remainingSeconds: Math.max(0, session.duration - currentElapsed),
  };
}

/**
 * Start a pomodoro.
 */
export async function startPomodoro(params: {
  taskId?: number;
  duration?: number;
  type?: PomodoroType;
  completedPomodoros?: number;
}) {
  // Cancel existing active sessions
  await prisma.pomodoroSession.updateMany({
    where: { status: { in: ['active', 'paused'] } },
    data: { status: 'cancelled', completedAt: new Date() },
  });

  const duration =
    params.duration ??
    (params.type === 'short_break'
      ? SHORT_BREAK_DURATION
      : params.type === 'long_break'
        ? LONG_BREAK_DURATION
        : WORK_DURATION);

  const session = await prisma.pomodoroSession.create({
    data: {
      taskId: params.taskId || null,
      status: 'active',
      type: params.type || 'work',
      duration,
      elapsed: 0,
      startedAt: new Date(),
      completedPomodoros: params.completedPomodoros || 0,
    },
    include: { task: { select: { id: true, title: true, status: true } } },
  });

  return {
    ...session,
    currentElapsed: 0,
    remainingSeconds: duration,
  };
}

/**
 * Pause a pomodoro.
 */
export async function pausePomodoro(sessionId: number) {
  const session = await prisma.pomodoroSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.status !== 'active') {
    throw new Error('アクティブなセッションが見つかりません');
  }

  // Save elapsed time up to now
  const additionalElapsed = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
  const newElapsed = Math.min(session.elapsed + additionalElapsed, session.duration);

  const updated = await prisma.pomodoroSession.update({
    where: { id: sessionId },
    data: {
      status: 'paused',
      elapsed: newElapsed,
      pausedAt: new Date(),
    },
    include: { task: { select: { id: true, title: true, status: true } } },
  });

  return {
    ...updated,
    currentElapsed: newElapsed,
    remainingSeconds: Math.max(0, updated.duration - newElapsed),
  };
}

/**
 * Resume a pomodoro.
 */
export async function resumePomodoro(sessionId: number) {
  const session = await prisma.pomodoroSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.status !== 'paused') {
    throw new Error('一時停止中のセッションが見つかりません');
  }

  const updated = await prisma.pomodoroSession.update({
    where: { id: sessionId },
    data: {
      status: 'active',
      startedAt: new Date(), // Update startedAt to resume time (calculated from elapsed + new startedAt)
      pausedAt: null,
    },
    include: { task: { select: { id: true, title: true, status: true } } },
  });

  return {
    ...updated,
    currentElapsed: updated.elapsed,
    remainingSeconds: Math.max(0, updated.duration - updated.elapsed),
  };
}

/**
 * Complete a pomodoro.
 */
export async function completePomodoro(sessionId: number) {
  const session = await prisma.pomodoroSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || !['active', 'paused'].includes(session.status)) {
    throw new Error('完了可能なセッションが見つかりません');
  }

  const newCompletedPomodoros =
    session.type === 'work' ? session.completedPomodoros + 1 : session.completedPomodoros;

  const updated = await prisma.pomodoroSession.update({
    where: { id: sessionId },
    data: {
      status: 'completed',
      elapsed: session.duration,
      completedAt: new Date(),
      completedPomodoros: newCompletedPomodoros,
    },
    include: { task: { select: { id: true, title: true, status: true } } },
  });

  // Auto-record TimeEntry when a work session completes
  if (session.type === 'work' && session.taskId) {
    const startTime = new Date(Date.now() - session.duration * 1000);
    await prisma.timeEntry.create({
      data: {
        taskId: session.taskId,
        duration: session.duration / 3600, // hours
        startedAt: startTime,
        endedAt: new Date(),
        note: `Complete a pomodoro. (${Math.round(session.duration / 60)}分)`,
      },
    });
  }

  // Determine next session type
  let nextType: PomodoroType = 'short_break';
  if (session.type === 'work') {
    if (newCompletedPomodoros % POMODOROS_BEFORE_LONG_BREAK === 0) {
      nextType = 'long_break';
    } else {
      nextType = 'short_break';
    }
  } else {
    nextType = 'work';
  }

  return {
    ...updated,
    currentElapsed: session.duration,
    remainingSeconds: 0,
    nextType,
    completedPomodoros: newCompletedPomodoros,
  };
}

/**
 * Cancel a pomodoro.
 */
export async function cancelPomodoro(sessionId: number) {
  return await prisma.pomodoroSession.update({
    where: { id: sessionId },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
    },
  });
}

/**
 * Get statistics.
 */
export async function getStatistics(params: { startDate?: Date; endDate?: Date; taskId?: number }) {
  const { startDate, endDate, taskId } = params;

  const where: Record<string, unknown> = {
    status: 'completed',
    type: 'work',
  };

  if (startDate || endDate) {
    where.completedAt = {
      ...(startDate && { gte: startDate }),
      ...(endDate && { lte: endDate }),
    };
  }
  if (taskId) {
    where.taskId = taskId;
  }

  const sessions = await prisma.pomodoroSession.findMany({
    where,
    include: { task: { select: { id: true, title: true } } },
    orderBy: { completedAt: 'desc' },
  });

  const totalPomodoros = sessions.length;
  const totalMinutes = sessions.reduce((sum, s) => sum + s.duration / 60, 0);

  // Daily aggregation
  const dailyMap = new Map<string, { count: number; minutes: number }>();
  for (const s of sessions) {
    const dateKey = (s.completedAt ?? s.createdAt).toISOString().split('T')[0]!;
    const existing = dailyMap.get(dateKey) || { count: 0, minutes: 0 };
    existing.count++;
    existing.minutes += s.duration / 60;
    dailyMap.set(dateKey, existing);
  }

  const dailyStats = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Per-task aggregation
  const taskMap = new Map<
    number,
    { taskId: number; title: string; count: number; minutes: number }
  >();
  for (const s of sessions) {
    if (s.taskId && s.task) {
      const existing = taskMap.get(s.taskId) || {
        taskId: s.taskId,
        title: s.task.title,
        count: 0,
        minutes: 0,
      };
      existing.count++;
      existing.minutes += s.duration / 60;
      taskMap.set(s.taskId, existing);
    }
  }

  const taskStats = Array.from(taskMap.values()).sort((a, b) => b.count - a.count);

  return {
    totalPomodoros,
    totalMinutes: Math.round(totalMinutes),
    averagePerDay:
      dailyStats.length > 0 ? Math.round((totalPomodoros / dailyStats.length) * 10) / 10 : 0,
    dailyStats,
    taskStats,
  };
}

/**
 * Get session history.
 */
export async function getHistory(params: { limit?: number; offset?: number }) {
  const { limit = 20, offset = 0 } = params;

  const [sessions, total] = await Promise.all([
    prisma.pomodoroSession.findMany({
      where: { status: { in: ['completed', 'cancelled'] } },
      include: { task: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.pomodoroSession.count({
      where: { status: { in: ['completed', 'cancelled'] } },
    }),
  ]);

  return { sessions, total };
}
