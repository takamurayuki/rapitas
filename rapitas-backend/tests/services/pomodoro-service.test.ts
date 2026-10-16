/**
 * Pomodoro Service テスト
 * ポモドーロタイマーのビジネスロジックテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const now = new Date('2026-03-05T10:00:00.000Z');

const mockPrisma = {
  pomodoroSession: {
    findFirst: mock(() => Promise.resolve(null)),
    findUnique: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve([])),
    create: mock(() => Promise.resolve({})),
    update: mock(() => Promise.resolve({})),
    updateMany: mock(() => Promise.resolve({ count: 0 })),
    count: mock(() => Promise.resolve(0)),
  },
  timeEntry: {
    create: mock(() => Promise.resolve({})),
  },
  // Consulted only on work-session completion, to resolve the study goal
  // (direct or theme-based) that recordPomodoroStudyTime should credit.
  task: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  studyGoal: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  studySession: {
    create: mock(() => Promise.resolve({ id: 1 })),
    upsert: mock(() => Promise.resolve({ id: 1 })),
    findUnique: mock(() => Promise.resolve(null)),
  },
  studyStreak: {
    upsert: mock(() => Promise.resolve({})),
  },
  $transaction: mock((ops: Promise<unknown>[]) => Promise.all(ops)),
};

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const {
  startPomodoro,
  pausePomodoro,
  resumePomodoro,
  completePomodoro,
  cancelPomodoro,
  checkpointPomodoro,
  getActiveSession,
  getStatistics,
  getHistory,
} = await import('../../services/scheduling/pomodoro-service');

describe('startPomodoro', () => {
  beforeEach(() => {
    for (const method of Object.values(mockPrisma.pomodoroSession)) {
      method.mockReset();
    }
    mockPrisma.pomodoroSession.updateMany.mockResolvedValue({ count: 0 });
  });

  test('デフォルトでwork=25分のセッションを作成すること', async () => {
    const session = {
      id: 1,
      taskId: null,
      status: 'active',
      type: 'work',
      duration: 1500,
      elapsed: 0,
      startedAt: now,
      completedPomodoros: 0,
      task: null,
    };
    mockPrisma.pomodoroSession.create.mockResolvedValue(session);

    const result = await startPomodoro({});

    const createCall = mockPrisma.pomodoroSession.create.mock.calls[0]![0] as {
      data: { duration: number; type: string };
    };
    expect(createCall.data.duration).toBe(1500); // 25 * 60
    expect(createCall.data.type).toBe('work');
    expect(result.currentElapsed).toBe(0);
    expect(result.remainingSeconds).toBe(1500);
  });

  test('short_breakタイプで5分のdurationを設定すること', async () => {
    const session = {
      id: 1,
      taskId: null,
      status: 'active',
      type: 'short_break',
      duration: 300,
      elapsed: 0,
      startedAt: now,
      completedPomodoros: 0,
      task: null,
    };
    mockPrisma.pomodoroSession.create.mockResolvedValue(session);

    await startPomodoro({ type: 'short_break' });

    const createCall = mockPrisma.pomodoroSession.create.mock.calls[0]![0] as {
      data: { duration: number };
    };
    expect(createCall.data.duration).toBe(300); // 5 * 60
  });

  test('long_breakタイプで15分のdurationを設定すること', async () => {
    const session = {
      id: 1,
      taskId: null,
      status: 'active',
      type: 'long_break',
      duration: 900,
      elapsed: 0,
      startedAt: now,
      completedPomodoros: 0,
      task: null,
    };
    mockPrisma.pomodoroSession.create.mockResolvedValue(session);

    await startPomodoro({ type: 'long_break' });

    const createCall = mockPrisma.pomodoroSession.create.mock.calls[0]![0] as {
      data: { duration: number };
    };
    expect(createCall.data.duration).toBe(900); // 15 * 60
  });

  test('カスタムdurationを指定できること', async () => {
    const session = {
      id: 1,
      taskId: null,
      status: 'active',
      type: 'work',
      duration: 3000,
      elapsed: 0,
      startedAt: now,
      completedPomodoros: 0,
      task: null,
    };
    mockPrisma.pomodoroSession.create.mockResolvedValue(session);

    await startPomodoro({ duration: 3000 });

    const createCall = mockPrisma.pomodoroSession.create.mock.calls[0]![0] as {
      data: { duration: number };
    };
    expect(createCall.data.duration).toBe(3000);
  });

  test('開始時に既存のアクティブセッションをキャンセルすること', async () => {
    const session = {
      id: 2,
      taskId: null,
      status: 'active',
      type: 'work',
      duration: 1500,
      elapsed: 0,
      startedAt: now,
      completedPomodoros: 0,
      task: null,
    };
    mockPrisma.pomodoroSession.create.mockResolvedValue(session);

    await startPomodoro({});

    expect(mockPrisma.pomodoroSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['active', 'paused'] } },
        data: expect.objectContaining({ status: 'cancelled' }),
      }),
    );
  });

  test('taskIdを設定できること', async () => {
    const session = {
      id: 1,
      taskId: 42,
      status: 'active',
      type: 'work',
      duration: 1500,
      elapsed: 0,
      startedAt: now,
      completedPomodoros: 0,
      task: { id: 42, title: 'Test', status: 'todo' },
    };
    mockPrisma.pomodoroSession.create.mockResolvedValue(session);

    await startPomodoro({ taskId: 42 });

    const createCall = mockPrisma.pomodoroSession.create.mock.calls[0]![0] as {
      data: { taskId: number };
    };
    expect(createCall.data.taskId).toBe(42);
  });
});

describe('pausePomodoro', () => {
  beforeEach(() => {
    mockPrisma.pomodoroSession.findUnique.mockReset();
    mockPrisma.pomodoroSession.update.mockReset();
  });

  test('アクティブでないセッションでエラーをスローすること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue(null);
    await expect(pausePomodoro(1)).rejects.toThrow('アクティブなセッションが見つかりません');
  });

  test('paused状態のセッションでエラーをスローすること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'paused',
      elapsed: 100,
      startedAt: now,
      duration: 1500,
    });
    await expect(pausePomodoro(1)).rejects.toThrow('アクティブなセッションが見つかりません');
  });

  test('一時停止時にelapsedを更新しremainingSecondsを返すこと', async () => {
    const startedAt = new Date(Date.now() - 120000); // 2 minutes ago
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 0,
      startedAt,
      duration: 1500,
    });
    const updated = {
      id: 1,
      status: 'paused',
      elapsed: 120,
      duration: 1500,
      startedAt,
      task: null,
    };
    mockPrisma.pomodoroSession.update.mockResolvedValue(updated);

    const result = await pausePomodoro(1);
    expect(result.remainingSeconds).toBe(1380); // 1500 - 120
  });
});

describe('resumePomodoro', () => {
  beforeEach(() => {
    mockPrisma.pomodoroSession.findUnique.mockReset();
    mockPrisma.pomodoroSession.update.mockReset();
  });

  test('paused以外のセッションでエラーをスローすること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue(null);
    await expect(resumePomodoro(1)).rejects.toThrow('一時停止中のセッションが見つかりません');
  });

  test('active状態のセッションでエラーをスローすること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 100,
      startedAt: now,
      duration: 1500,
    });
    await expect(resumePomodoro(1)).rejects.toThrow('一時停止中のセッションが見つかりません');
  });

  test('再開時にstatusをactiveに変更すること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'paused',
      elapsed: 300,
      startedAt: now,
      duration: 1500,
    });
    const updated = {
      id: 1,
      status: 'active',
      elapsed: 300,
      duration: 1500,
      startedAt: now,
      task: null,
    };
    mockPrisma.pomodoroSession.update.mockResolvedValue(updated);

    const result = await resumePomodoro(1);
    expect(result.currentElapsed).toBe(300);
    expect(result.remainingSeconds).toBe(1200); // 1500 - 300
  });
});

describe('completePomodoro', () => {
  beforeEach(() => {
    mockPrisma.pomodoroSession.findUnique.mockReset();
    mockPrisma.pomodoroSession.update.mockReset();
    mockPrisma.timeEntry.create.mockReset();
    mockPrisma.task.findUnique.mockReset();
    mockPrisma.task.findUnique.mockResolvedValue(null);
    mockPrisma.studyGoal.findFirst.mockReset();
    mockPrisma.studyGoal.findFirst.mockResolvedValue(null);
    mockPrisma.studySession.create.mockReset();
    mockPrisma.studySession.create.mockResolvedValue({ id: 1 });
    mockPrisma.studySession.upsert.mockReset();
    mockPrisma.studySession.upsert.mockResolvedValue({ id: 1 });
    mockPrisma.studySession.findUnique.mockReset();
    mockPrisma.studySession.findUnique.mockResolvedValue(null);
    mockPrisma.studyStreak.upsert.mockReset();
    mockPrisma.studyStreak.upsert.mockResolvedValue({});
  });

  test('active/paused以外のセッションでエラーをスローすること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue(null);
    await expect(completePomodoro(1)).rejects.toThrow('完了可能なセッションが見つかりません');
  });

  test('completedセッションでエラーをスローすること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'completed',
      elapsed: 1500,
      startedAt: now,
      duration: 1500,
      type: 'work',
      completedPomodoros: 1,
      taskId: null,
    });
    await expect(completePomodoro(1)).rejects.toThrow('完了可能なセッションが見つかりません');
  });

  test('work完了後にshort_breakをnextTypeとして返すこと', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 1500,
      startedAt: now,
      duration: 1500,
      type: 'work',
      completedPomodoros: 0,
      taskId: null,
    });
    const updated = {
      id: 1,
      status: 'completed',
      elapsed: 1500,
      duration: 1500,
      type: 'work',
      completedPomodoros: 1,
      task: null,
    };
    mockPrisma.pomodoroSession.update.mockResolvedValue(updated);

    const result = await completePomodoro(1);
    expect(result.nextType).toBe('short_break');
    expect(result.completedPomodoros).toBe(1);
  });

  test('4回目のwork完了後にlong_breakをnextTypeとして返すこと', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 1500,
      startedAt: now,
      duration: 1500,
      type: 'work',
      completedPomodoros: 3,
      taskId: null,
    });
    const updated = {
      id: 1,
      status: 'completed',
      elapsed: 1500,
      duration: 1500,
      type: 'work',
      completedPomodoros: 4,
      task: null,
    };
    mockPrisma.pomodoroSession.update.mockResolvedValue(updated);

    const result = await completePomodoro(1);
    expect(result.nextType).toBe('long_break');
  });

  test('break完了後にworkをnextTypeとして返すこと', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 300,
      startedAt: now,
      duration: 300,
      type: 'short_break',
      completedPomodoros: 2,
      taskId: null,
    });
    const updated = {
      id: 1,
      status: 'completed',
      elapsed: 300,
      duration: 300,
      type: 'short_break',
      completedPomodoros: 2,
      task: null,
    };
    mockPrisma.pomodoroSession.update.mockResolvedValue(updated);

    const result = await completePomodoro(1);
    expect(result.nextType).toBe('work');
    // break doesn't increment completedPomodoros
    expect(result.completedPomodoros).toBe(2);
  });

  test('work完了かつtaskIdありの場合TimeEntryを作成すること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 1500,
      startedAt: now,
      duration: 1500,
      type: 'work',
      completedPomodoros: 0,
      taskId: 42,
    });
    const updated = {
      id: 1,
      status: 'completed',
      elapsed: 1500,
      duration: 1500,
      type: 'work',
      completedPomodoros: 1,
      task: { id: 42, title: 'Test', status: 'todo' },
    };
    mockPrisma.pomodoroSession.update.mockResolvedValue(updated);

    await completePomodoro(1);
    expect(mockPrisma.timeEntry.create).toHaveBeenCalledTimes(1);

    const createCall = mockPrisma.timeEntry.create.mock.calls[0]![0] as {
      data: { taskId: number; duration: number; note: string };
    };
    expect(createCall.data.taskId).toBe(42);
    expect(createCall.data.duration).toBeCloseTo(1500 / 3600, 4); // hours
    expect(createCall.data.note).toContain('25分');
  });

  test('work完了かつタスクがstudyGoalIdに直接紐づく場合StudySessionを自動記録すること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 1500,
      startedAt: now,
      duration: 1500,
      type: 'work',
      completedPomodoros: 0,
      taskId: 42,
    });
    mockPrisma.pomodoroSession.update.mockResolvedValue({
      id: 1,
      status: 'completed',
      elapsed: 1500,
      duration: 1500,
      type: 'work',
      completedPomodoros: 1,
      task: { id: 42, title: 'Test', status: 'todo' },
    });
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });

    await completePomodoro(1);

    expect(mockPrisma.studyGoal.findFirst).not.toHaveBeenCalled();
    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { goalId: number; minutes: number; source: string; pomodoroSessionId: number };
    };
    expect(upsertCall.create).toEqual(
      expect.objectContaining({ goalId: 7, minutes: 25, source: 'pomodoro', pomodoroSessionId: 1 }),
    );
  });

  test('work完了かつタスクのthemeId経由でStudySessionを自動記録すること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 2,
      status: 'active',
      elapsed: 1500,
      startedAt: now,
      duration: 1500,
      type: 'work',
      completedPomodoros: 0,
      taskId: 43,
    });
    mockPrisma.pomodoroSession.update.mockResolvedValue({
      id: 2,
      status: 'completed',
      elapsed: 1500,
      duration: 1500,
      type: 'work',
      completedPomodoros: 1,
      task: { id: 43, title: 'Test', status: 'todo' },
    });
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: null, themeId: 12 });
    mockPrisma.studyGoal.findFirst.mockResolvedValue({ id: 88 });

    await completePomodoro(2);

    expect(mockPrisma.studyGoal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ themeId: 12, status: 'active' }),
      }),
    );
    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { goalId: number; pomodoroSessionId: number };
    };
    expect(upsertCall.create).toEqual(
      expect.objectContaining({ goalId: 88, pomodoroSessionId: 2 }),
    );
  });

  test('紐づけの無いテーマ/タスクではStudySessionを記録しないこと', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 3,
      status: 'active',
      elapsed: 1500,
      startedAt: now,
      duration: 1500,
      type: 'work',
      completedPomodoros: 0,
      taskId: 44,
    });
    mockPrisma.pomodoroSession.update.mockResolvedValue({
      id: 3,
      status: 'completed',
      elapsed: 1500,
      duration: 1500,
      type: 'work',
      completedPomodoros: 1,
      task: { id: 44, title: 'Test', status: 'todo' },
    });
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: null, themeId: null });

    await completePomodoro(3);

    expect(mockPrisma.studySession.upsert).not.toHaveBeenCalled();
  });

  test('60秒のポモドーロは1分としてStudySessionに記録すること(切り上げ境界)', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 4,
      status: 'active',
      elapsed: 60,
      startedAt: now,
      duration: 60,
      type: 'work',
      completedPomodoros: 0,
      taskId: 42,
    });
    mockPrisma.pomodoroSession.update.mockResolvedValue({
      id: 4,
      status: 'completed',
      elapsed: 60,
      duration: 60,
      type: 'work',
      completedPomodoros: 1,
      task: { id: 42, title: 'Test', status: 'todo' },
    });
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });

    await completePomodoro(4);

    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { minutes: number };
    };
    expect(upsertCall.create.minutes).toBe(1);
  });

  test('61秒のポモドーロは2分としてStudySessionに記録すること(切り上げ境界)', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 5,
      status: 'active',
      elapsed: 61,
      startedAt: now,
      duration: 61,
      type: 'work',
      completedPomodoros: 0,
      taskId: 42,
    });
    mockPrisma.pomodoroSession.update.mockResolvedValue({
      id: 5,
      status: 'completed',
      elapsed: 61,
      duration: 61,
      type: 'work',
      completedPomodoros: 1,
      task: { id: 42, title: 'Test', status: 'todo' },
    });
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });

    await completePomodoro(5);

    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { minutes: number };
    };
    expect(upsertCall.create.minutes).toBe(2);
  });

  test('break完了時はTimeEntryを作成しないこと', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 300,
      startedAt: now,
      duration: 300,
      type: 'short_break',
      completedPomodoros: 1,
      taskId: 42,
    });
    const updated = {
      id: 1,
      status: 'completed',
      elapsed: 300,
      duration: 300,
      type: 'short_break',
      completedPomodoros: 1,
      task: null,
    };
    mockPrisma.pomodoroSession.update.mockResolvedValue(updated);

    await completePomodoro(1);
    expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
  });

  test('work完了かつtaskIdなしの場合TimeEntryを作成しないこと', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 1500,
      startedAt: now,
      duration: 1500,
      type: 'work',
      completedPomodoros: 0,
      taskId: null,
    });
    const updated = {
      id: 1,
      status: 'completed',
      elapsed: 1500,
      duration: 1500,
      type: 'work',
      completedPomodoros: 1,
      task: null,
    };
    mockPrisma.pomodoroSession.update.mockResolvedValue(updated);

    await completePomodoro(1);
    expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
  });
});

describe('checkpointPomodoro', () => {
  beforeEach(() => {
    mockPrisma.pomodoroSession.findUnique.mockReset();
    mockPrisma.pomodoroSession.update.mockReset();
    mockPrisma.task.findUnique.mockReset();
    mockPrisma.task.findUnique.mockResolvedValue(null);
    mockPrisma.studyGoal.findFirst.mockReset();
    mockPrisma.studyGoal.findFirst.mockResolvedValue(null);
    mockPrisma.studySession.upsert.mockReset();
    mockPrisma.studySession.upsert.mockResolvedValue({ id: 1 });
    mockPrisma.studySession.findUnique.mockReset();
    mockPrisma.studySession.findUnique.mockResolvedValue(null);
    mockPrisma.studyStreak.upsert.mockReset();
    mockPrisma.studyStreak.upsert.mockResolvedValue({});
  });

  test('存在しないセッションでエラーをスローすること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue(null);
    await expect(checkpointPomodoro(1)).rejects.toThrow('セッションが見つかりません');
  });

  test('pausedセッションでエラーをスローすること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'paused',
      elapsed: 100,
      startedAt: now,
      duration: 1500,
      type: 'work',
      taskId: 42,
    });
    await expect(checkpointPomodoro(1)).rejects.toThrow('記録可能なセッションが見つかりません');
  });

  test('completedセッションでエラーをスローすること', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'completed',
      elapsed: 1500,
      startedAt: now,
      duration: 1500,
      type: 'work',
      taskId: 42,
    });
    await expect(checkpointPomodoro(1)).rejects.toThrow('記録可能なセッションが見つかりません');
  });

  test('activeなworkセッションで学習時間が記録され、ステータスは変更しないこと', async () => {
    const startedAt = new Date(Date.now() - 30000); // 30 seconds ago
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 0,
      startedAt,
      duration: 1500,
      type: 'work',
      taskId: 42,
    });
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });
    mockPrisma.studySession.findUnique.mockResolvedValue({ id: 9, minutes: 1 });

    const result = await checkpointPomodoro(1);

    expect(mockPrisma.pomodoroSession.update).not.toHaveBeenCalled();
    expect(mockPrisma.studySession.upsert).toHaveBeenCalledTimes(1);
    expect(result.studyMinutesRecorded).toBe(1);
  });

  test('休憩セッション(type!==work)ではno-opで0を返すこと', async () => {
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 100,
      startedAt: now,
      duration: 300,
      type: 'short_break',
      taskId: 42,
    });

    const result = await checkpointPomodoro(1);

    expect(mockPrisma.studySession.upsert).not.toHaveBeenCalled();
    expect(result.studyMinutesRecorded).toBe(0);
  });

  test('テーマに紐づかないタスクではno-opで0を返すこと', async () => {
    const startedAt = new Date(Date.now() - 1500000);
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 0,
      startedAt,
      duration: 1500,
      type: 'work',
      taskId: 44,
    });
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: null, themeId: null });

    const result = await checkpointPomodoro(1);

    expect(mockPrisma.studySession.upsert).not.toHaveBeenCalled();
    expect(result.studyMinutesRecorded).toBe(0);
  });

  test('59秒は1分に切り上げること(境界値)', async () => {
    const startedAt = new Date(Date.now() - 59000);
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 0,
      startedAt,
      duration: 1500,
      type: 'work',
      taskId: 42,
    });
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });

    await checkpointPomodoro(1);

    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { minutes: number };
    };
    expect(upsertCall.create.minutes).toBe(1);
  });

  test('61秒は2分に切り上げること(境界値)', async () => {
    const startedAt = new Date(Date.now() - 61000);
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 0,
      startedAt,
      duration: 1500,
      type: 'work',
      taskId: 42,
    });
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });

    await checkpointPomodoro(1);

    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { minutes: number };
    };
    expect(upsertCall.create.minutes).toBe(2);
  });

  test('途中記録→完了の順で合計がceil(総経過秒/60)になり二重計上しないこと', async () => {
    // Both create.minutes and update.minutes carry the same freshly-computed
    // value in recordStudySession's upsert call, so tracking either one
    // faithfully simulates "overwrite, not accumulate" without needing to
    // model Prisma's own create-vs-update branching.
    let storedMinutes = 0;
    mockPrisma.studySession.upsert.mockImplementation((args: { create: { minutes: number } }) => {
      storedMinutes = args.create.minutes;
      return Promise.resolve({ id: 1, minutes: storedMinutes });
    });
    mockPrisma.studySession.findUnique.mockImplementation(() =>
      Promise.resolve(storedMinutes > 0 ? { id: 1, minutes: storedMinutes } : null),
    );
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });

    // Checkpoint at 900s elapsed into a 1500s work session.
    const startedAt = new Date(Date.now() - 900000);
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 0,
      startedAt,
      duration: 1500,
      type: 'work',
      taskId: 42,
    });

    const checkpointResult = await checkpointPomodoro(1);
    expect(checkpointResult.studyMinutesRecorded).toBe(15); // ceil(900/60) = 15
    expect(storedMinutes).toBe(15);

    // Complete the same session — completePomodoro always credits the full
    // configured duration (existing #818 behavior), so the checkpoint's
    // partial value is overwritten rather than added to.
    mockPrisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 900,
      startedAt: now,
      duration: 1500,
      type: 'work',
      completedPomodoros: 0,
      taskId: 42,
    });
    mockPrisma.pomodoroSession.update.mockResolvedValue({
      id: 1,
      status: 'completed',
      elapsed: 1500,
      duration: 1500,
      type: 'work',
      completedPomodoros: 1,
      task: { id: 42, title: 'Test', status: 'todo' },
    });

    await completePomodoro(1);

    // Total recorded minutes = ceil(1500/60) = 25, not 15(checkpoint) + 25(complete) = 40.
    expect(storedMinutes).toBe(25);
  });
});

describe('cancelPomodoro', () => {
  beforeEach(() => {
    mockPrisma.pomodoroSession.update.mockReset();
  });

  test('セッションをcancelled状態に更新すること', async () => {
    mockPrisma.pomodoroSession.update.mockResolvedValue({
      id: 1,
      status: 'cancelled',
    });

    await cancelPomodoro(1);

    const updateCall = mockPrisma.pomodoroSession.update.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(updateCall.data.status).toBe('cancelled');
  });
});

describe('getActiveSession', () => {
  beforeEach(() => {
    mockPrisma.pomodoroSession.findFirst.mockReset();
  });

  test('アクティブセッションがない場合nullを返すこと', async () => {
    mockPrisma.pomodoroSession.findFirst.mockResolvedValue(null);
    const result = await getActiveSession();
    expect(result).toBeNull();
  });

  test('paused状態ではelapsedをそのまま返すこと', async () => {
    mockPrisma.pomodoroSession.findFirst.mockResolvedValue({
      id: 1,
      status: 'paused',
      elapsed: 500,
      startedAt: now,
      duration: 1500,
      task: null,
    });

    const result = await getActiveSession();
    expect(result!.currentElapsed).toBe(500);
    expect(result!.remainingSeconds).toBe(1000);
  });

  test('active状態では経過時間を計算すること', async () => {
    const startedAt = new Date(Date.now() - 60000); // 1 minute ago
    mockPrisma.pomodoroSession.findFirst.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 0,
      startedAt,
      duration: 1500,
      task: null,
    });

    const result = await getActiveSession();
    // currentElapsed should be approximately 60 seconds
    expect(result!.currentElapsed).toBeGreaterThanOrEqual(59);
    expect(result!.currentElapsed).toBeLessThanOrEqual(62);
  });

  test('currentElapsedがdurationを超えないこと', async () => {
    const startedAt = new Date(Date.now() - 3600000); // 1 hour ago
    mockPrisma.pomodoroSession.findFirst.mockResolvedValue({
      id: 1,
      status: 'active',
      elapsed: 0,
      startedAt,
      duration: 1500,
      task: null,
    });

    const result = await getActiveSession();
    expect(result!.currentElapsed).toBe(1500);
    expect(result!.remainingSeconds).toBe(0);
  });
});

describe('getStatistics', () => {
  beforeEach(() => {
    mockPrisma.pomodoroSession.findMany.mockReset();
  });

  test('セッションがない場合ゼロ値を返すこと', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([]);

    const result = await getStatistics({});
    expect(result.totalPomodoros).toBe(0);
    expect(result.totalMinutes).toBe(0);
    expect(result.averagePerDay).toBe(0);
    expect(result.dailyStats).toEqual([]);
    expect(result.taskStats).toEqual([]);
  });

  test('日別集計とタスク別集計を正しく計算すること', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([
      {
        id: 1,
        duration: 1500,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: 1,
        task: { id: 1, title: 'Task A' },
      },
      {
        id: 2,
        duration: 1500,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: 1,
        task: { id: 1, title: 'Task A' },
      },
      {
        id: 3,
        duration: 1500,
        completedAt: new Date('2026-03-04'),
        createdAt: new Date('2026-03-04'),
        taskId: 2,
        task: { id: 2, title: 'Task B' },
      },
    ]);

    const result = await getStatistics({});
    expect(result.totalPomodoros).toBe(3);
    expect(result.totalMinutes).toBe(75); // 3 * 25
    expect(result.dailyStats.length).toBe(2);
    expect(result.taskStats.length).toBe(2);
    // Task A has 2 pomodoros, sorted first
    expect(result.taskStats[0]!.title).toBe('Task A');
    expect(result.taskStats[0]!.count).toBe(2);
  });

  test('averagePerDayを正しく計算すること', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([
      {
        id: 1,
        duration: 1500,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: null,
        task: null,
      },
      {
        id: 2,
        duration: 1500,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: null,
        task: null,
      },
      {
        id: 3,
        duration: 1500,
        completedAt: new Date('2026-03-04'),
        createdAt: new Date('2026-03-04'),
        taskId: null,
        task: null,
      },
    ]);

    const result = await getStatistics({});
    // 3 pomodoros / 2 days = 1.5
    expect(result.averagePerDay).toBe(1.5);
  });
});

describe('getHistory', () => {
  beforeEach(() => {
    mockPrisma.pomodoroSession.findMany.mockReset();
    mockPrisma.pomodoroSession.count.mockReset();
  });

  test('セッション履歴とtotalを返すこと', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([
      { id: 1, status: 'completed' },
      { id: 2, status: 'cancelled' },
    ]);
    mockPrisma.pomodoroSession.count.mockResolvedValue(10);

    const result = await getHistory({});
    expect(result.sessions.length).toBe(2);
    expect(result.total).toBe(10);
  });

  test('デフォルトでlimit=20, offset=0を使用すること', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([]);
    mockPrisma.pomodoroSession.count.mockResolvedValue(0);

    await getHistory({});

    const findCall = mockPrisma.pomodoroSession.findMany.mock.calls[0]![0] as {
      take: number;
      skip: number;
    };
    expect(findCall.take).toBe(20);
    expect(findCall.skip).toBe(0);
  });

  test('カスタムlimit/offsetを使用できること', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([]);
    mockPrisma.pomodoroSession.count.mockResolvedValue(0);

    await getHistory({ limit: 5, offset: 10 });

    const findCall = mockPrisma.pomodoroSession.findMany.mock.calls[0]![0] as {
      take: number;
      skip: number;
    };
    expect(findCall.take).toBe(5);
    expect(findCall.skip).toBe(10);
  });
});
