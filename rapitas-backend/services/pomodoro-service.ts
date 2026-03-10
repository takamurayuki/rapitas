/**
 * Pomodoro Service
 * ポモドーロタイマーのビジネスロジック
 */
import { prisma } from '../config/database';

// デフォルト設定
const WORK_DURATION = 25 * 60; // 25分
const SHORT_BREAK_DURATION = 5 * 60; // 5分
const LONG_BREAK_DURATION = 15 * 60; // 15分
const POMODOROS_BEFORE_LONG_BREAK = 4;

export type PomodoroStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type PomodoroType = 'work' | 'short_break' | 'long_break';

/**
 * アクティブなセッションを取得（現在のelapsedを計算して返す）
 */
export async function getActiveSession() {
  const session = await prisma.pomodoroSession.findFirst({
    where: { status: { in: ['active', 'paused'] } },
    include: { task: { select: { id: true, title: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });

  if (!session) return null;

  // activeな場合は現在の経過時間を計算
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
 * ポモドーロ開始
 */
export async function startPomodoro(params: {
  taskId?: number;
  duration?: number;
  type?: PomodoroType;
  completedPomodoros?: number;
}) {
  // 既存のアクティブセッションをキャンセル
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
 * ポモドーロ一時停止
 */
export async function pausePomodoro(sessionId: number) {
  const session = await prisma.pomodoroSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.status !== 'active') {
    throw new Error('アクティブなセッションが見つかりません');
  }

  // 現在までの経過時間を保存
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
 * ポモドーロ再開
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
      startedAt: new Date(), // 再開時刻をstartedAtに更新（elapsed+新startedAtで計算）
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
 * ポモドーロ完了
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

  // 作業セッション完了時にTimeEntryを自動記録
  if (session.type === 'work' && session.taskId) {
    const startTime = new Date(Date.now() - session.duration * 1000);
    await prisma.timeEntry.create({
      data: {
        taskId: session.taskId,
        duration: session.duration / 3600, // hours
        startedAt: startTime,
        endedAt: new Date(),
        note: `ポモドーロ完了 (${Math.round(session.duration / 60)}分)`,
      },
    });
  }

  // 次のセッションタイプを判定
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
 * ポモドーロキャンセル
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
 * 統計情報を取得
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

  // 日別集計
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

  // タスク別集計
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
 * セッション履歴を取得
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
