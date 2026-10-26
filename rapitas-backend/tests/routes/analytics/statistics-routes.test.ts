/**
 * Statistics Routes テスト
 * ダッシュボード統計APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    count: mock(() => Promise.resolve(0)),
    findMany: mock(() => Promise.resolve([])),
  },
  timeEntry: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { statisticsRoutes } = await import('../../../routes/analytics/statistics');

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === 'object' && model !== null) {
      for (const method of Object.values(model)) {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as ReturnType<typeof mock>).mockReset();
        }
      }
    }
  }
  mockPrisma.task.count.mockResolvedValue(0);
  mockPrisma.task.findMany.mockResolvedValue([]);
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
}

function createApp() {
  return new Elysia().use(statisticsRoutes);
}

describe('GET /statistics/overview', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('概要統計を返すこと', async () => {
    mockPrisma.task.count
      .mockResolvedValueOnce(50) // totalTasks
      .mockResolvedValueOnce(30) // completedTasks
      .mockResolvedValueOnce(3) // todayCompleted
      .mockResolvedValueOnce(10); // weekCompleted

    const res = await app.handle(new Request('http://localhost/statistics/overview'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tasks).toBeDefined();
    expect(body.tasks.total).toBe(50);
    expect(body.tasks.completed).toBe(30);
    expect(body.tasks.completionRate).toBe(60);
    // The learning features were removed: the overview must no longer carry
    // study hours, exam goals or the streak, and must not query for them.
    expect(body.studyTime).toBeUndefined();
    expect(body.upcomingExams).toBeUndefined();
    expect(body.streakData).toBeUndefined();
    expect(mockPrisma.timeEntry.findMany).not.toHaveBeenCalled();
  });

  test('タスクがゼロの場合completionRateが0であること', async () => {
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/statistics/overview'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tasks.completionRate).toBe(0);
  });
});

describe('GET /statistics/daily-study', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('日別学習時間を返すこと', async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/statistics/daily-study'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    // Default is 7 days
    expect(body.length).toBe(7);
  });

  test('daysパラメータで期間を指定できること', async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/statistics/daily-study?days=14'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(14);
  });

  test('各日のデータにdateとhoursが含まれること', async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/statistics/daily-study?days=3'));
    const body = await res.json();

    expect(res.status).toBe(200);
    for (const entry of body) {
      expect(entry.date).toBeDefined();
      expect(typeof entry.hours).toBe('number');
    }
  });
});
