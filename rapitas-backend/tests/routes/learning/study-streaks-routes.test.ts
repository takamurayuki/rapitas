/**
 * Study Streaks Routes テスト
 * 学習ストリークAPIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  studyStreak: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    upsert: mock(() => Promise.resolve({ id: 1 })),
  },
};

mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { studyStreaksRoutes } = await import('../../../routes/learning/study-streaks');

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
}

function createApp() {
  return new Elysia().use(studyStreaksRoutes);
}

describe('GET /study-streaks', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ストリークデータを返すこと', async () => {
    const streaks = [
      { id: 1, date: new Date('2026-03-01'), studyMinutes: 60, tasksCompleted: 2 },
      { id: 2, date: new Date('2026-03-02'), studyMinutes: 90, tasksCompleted: 3 },
    ];
    mockPrisma.studyStreak.findMany.mockResolvedValue(streaks);

    const res = await app.handle(new Request('http://localhost/study-streaks'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  test('daysパラメータでフィルタできること', async () => {
    mockPrisma.studyStreak.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/study-streaks?days=7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('空配列を返すこと', async () => {
    mockPrisma.studyStreak.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/study-streaks'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('GET /study-streaks/current', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('現在のストリーク情報を返すこと', async () => {
    // No streaks today
    mockPrisma.studyStreak.findUnique.mockResolvedValue(null);
    mockPrisma.studyStreak.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/study-streaks/current'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.currentStreak).toBeDefined();
    expect(body.longestStreak).toBeDefined();
    expect(body.today).toBeDefined();
  });

  test('連続日数を正しく計算すること', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // First call is today, second call is yesterday, third call returns null
    let callCount = 0;
    mockPrisma.studyStreak.findUnique.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ date: today, studyMinutes: 30, tasksCompleted: 1 });
      }
      if (callCount === 2) {
        return Promise.resolve({ date: yesterday, studyMinutes: 60, tasksCompleted: 2 });
      }
      return Promise.resolve(null);
    });
    mockPrisma.studyStreak.findMany.mockResolvedValue([
      { date: yesterday, studyMinutes: 60, tasksCompleted: 2 },
      { date: today, studyMinutes: 30, tasksCompleted: 1 },
    ]);

    const res = await app.handle(new Request('http://localhost/study-streaks/current'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.currentStreak).toBe(2);
    expect(body.longestStreak).toBeGreaterThanOrEqual(2);
  });
});

describe('POST /study-streaks/record', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('学習記録を追加すること', async () => {
    const recorded = {
      id: 1,
      date: new Date('2026-03-06'),
      studyMinutes: 60,
      tasksCompleted: 2,
    };
    mockPrisma.studyStreak.upsert.mockResolvedValue(recorded);

    const res = await app.handle(
      new Request('http://localhost/study-streaks/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studyMinutes: 60, tasksCompleted: 2 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.studyMinutes).toBe(60);
  });

  test('日付指定で学習記録を追加すること', async () => {
    const recorded = {
      id: 1,
      date: new Date('2026-03-05'),
      studyMinutes: 30,
      tasksCompleted: 1,
    };
    mockPrisma.studyStreak.upsert.mockResolvedValue(recorded);

    const res = await app.handle(
      new Request('http://localhost/study-streaks/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2026-03-05',
          studyMinutes: 30,
          tasksCompleted: 1,
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.studyMinutes).toBe(30);
  });

  test('空bodyでも記録できること', async () => {
    const recorded = {
      id: 1,
      date: new Date(),
      studyMinutes: 0,
      tasksCompleted: 0,
    };
    mockPrisma.studyStreak.upsert.mockResolvedValue(recorded);

    const res = await app.handle(
      new Request('http://localhost/study-streaks/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
  });
});
