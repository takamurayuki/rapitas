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
};

mock.module('../../config/database', () => ({
  prisma: mockPrisma,
}));

const {
  startPomodoro,
  pausePomodoro,
  resumePomodoro,
  completePomodoro,
  cancelPomodoro,
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
