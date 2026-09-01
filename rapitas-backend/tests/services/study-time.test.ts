/**
 * study-time サービス テスト
 * 学習時間記録ヘルパーのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  studySession: {
    create: mock(() => Promise.resolve({ id: 1 })),
    upsert: mock(() => Promise.resolve({ id: 1 })),
    findUnique: mock(() => Promise.resolve(null)),
    delete: mock(() => Promise.resolve({})),
  },
  studyStreak: {
    upsert: mock(() => Promise.resolve({})),
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
  task: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  studyGoal: {
    findFirst: mock(() => Promise.resolve(null)),
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

const { recordStudySession, recordPomodoroStudyTime } =
  await import('../../services/learning/study-time');

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === 'function' && 'mockReset' in model) {
      (model as ReturnType<typeof mock>).mockReset();
      continue;
    }
    if (typeof model === 'object' && model !== null) {
      for (const method of Object.values(model)) {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as ReturnType<typeof mock>).mockReset();
        }
      }
    }
  }
  mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
}

describe('recordStudySession', () => {
  beforeEach(() => {
    resetAllMocks();
    mockPrisma.studySession.create.mockResolvedValue({ id: 1 });
    mockPrisma.studySession.upsert.mockResolvedValue({ id: 1 });
  });

  test('pomodoroSessionId省略時はcreateで保存すること', async () => {
    await recordStudySession({ minutes: 30 });

    expect(mockPrisma.studySession.upsert).not.toHaveBeenCalled();
    const createCall = mockPrisma.studySession.create.mock.calls[0]![0] as {
      data: { pomodoroSessionId: number | null };
    };
    expect(createCall.data.pomodoroSessionId).toBeNull();
  });

  test('新規pomodoroSessionIdはupsert.createのdataに含めること', async () => {
    mockPrisma.studySession.findUnique.mockResolvedValue(null);

    await recordStudySession({ minutes: 25, goalId: 3, source: 'pomodoro', pomodoroSessionId: 99 });

    expect(mockPrisma.studySession.create).not.toHaveBeenCalled();
    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      where: { pomodoroSessionId: number };
      create: { pomodoroSessionId: number | null; minutes: number };
    };
    expect(upsertCall.where.pomodoroSessionId).toBe(99);
    expect(upsertCall.create.pomodoroSessionId).toBe(99);
    expect(upsertCall.create.minutes).toBe(25);
  });

  test('既存pomodoroSessionIdへの再記録はminutesを上書きし加算しないこと', async () => {
    mockPrisma.studySession.findUnique.mockResolvedValue({
      id: 5,
      minutes: 10,
      studiedAt: new Date('2026-03-05T09:00:00.000Z'),
    });

    await recordStudySession({ minutes: 25, goalId: 3, source: 'pomodoro', pomodoroSessionId: 99 });

    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      update: { minutes: number };
    };
    expect(upsertCall.update.minutes).toBe(25);

    const streakCall = mockPrisma.studyStreak.upsert.mock.calls[0]![0] as {
      update: { studyMinutes: { increment: number } };
    };
    // delta = new(25) - old(10) = 15, not the full 25 (would double-count otherwise)
    expect(streakCall.update.studyMinutes.increment).toBe(15);
  });
});

describe('recordPomodoroStudyTime', () => {
  beforeEach(() => {
    resetAllMocks();
    mockPrisma.studySession.upsert.mockResolvedValue({ id: 1 });
  });

  test('タスクの直接紐づけ(studyGoalId)経由で記録されること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });

    await recordPomodoroStudyTime({ taskId: 42, pomodoroSessionId: 501, durationSeconds: 1500 });

    expect(mockPrisma.studyGoal.findFirst).not.toHaveBeenCalled();
    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { goalId: number; minutes: number; source: string; pomodoroSessionId: number };
    };
    expect(upsertCall.create).toEqual(
      expect.objectContaining({
        goalId: 7,
        minutes: 25,
        source: 'pomodoro',
        pomodoroSessionId: 501,
      }),
    );
  });

  test('テーマ紐づけ(themeId経由)で記録されること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: null, themeId: 12 });
    mockPrisma.studyGoal.findFirst.mockResolvedValue({ id: 88 });

    await recordPomodoroStudyTime({ taskId: 43, pomodoroSessionId: 502, durationSeconds: 1500 });

    expect(mockPrisma.studyGoal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ themeId: 12, status: 'active' }),
      }),
    );
    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { goalId: number; pomodoroSessionId: number };
    };
    expect(upsertCall.create).toEqual(
      expect.objectContaining({ goalId: 88, pomodoroSessionId: 502 }),
    );
  });

  test('直接紐づけとテーマ紐づけの両方が無ければ何も記録しないこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: null, themeId: null });

    await recordPomodoroStudyTime({ taskId: 44, pomodoroSessionId: 503, durationSeconds: 1500 });

    expect(mockPrisma.studyGoal.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.studySession.upsert).not.toHaveBeenCalled();
  });

  test('テーマにactiveなStudyGoalが無ければ何も記録しないこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: null, themeId: 12 });
    mockPrisma.studyGoal.findFirst.mockResolvedValue(null);

    await recordPomodoroStudyTime({ taskId: 45, pomodoroSessionId: 504, durationSeconds: 1500 });

    expect(mockPrisma.studySession.upsert).not.toHaveBeenCalled();
  });

  test('60秒は1分に切り上げること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });

    await recordPomodoroStudyTime({ taskId: 42, pomodoroSessionId: 505, durationSeconds: 60 });

    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { minutes: number };
    };
    expect(upsertCall.create.minutes).toBe(1);
  });

  test('61秒は2分に切り上げること(境界値)', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });

    await recordPomodoroStudyTime({ taskId: 42, pomodoroSessionId: 506, durationSeconds: 61 });

    const upsertCall = mockPrisma.studySession.upsert.mock.calls[0]![0] as {
      create: { minutes: number };
    };
    expect(upsertCall.create.minutes).toBe(2);
  });

  test('DBエラー時は例外を投げず握りつぶすこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ studyGoalId: 7, themeId: null });
    mockPrisma.studySession.upsert.mockImplementation(() => Promise.reject(new Error('P2002')));

    await expect(
      recordPomodoroStudyTime({ taskId: 42, pomodoroSessionId: 507, durationSeconds: 1500 }),
    ).resolves.toBeUndefined();
  });

  test('タスクが存在しなければ何も記録しないこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    await recordPomodoroStudyTime({ taskId: 99, pomodoroSessionId: 508, durationSeconds: 1500 });

    expect(mockPrisma.studySession.upsert).not.toHaveBeenCalled();
  });
});
