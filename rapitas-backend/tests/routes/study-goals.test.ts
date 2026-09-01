/**
 * Study Goals Routes テスト
 * 学習目標APIのthemeId紐づけ/解除に関するユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  studyGoal: {
    findMany: mock(() => Promise.resolve([])),
    create: mock(() => Promise.resolve({})),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  task: {
    groupBy: mock(() => Promise.resolve([])),
  },
};

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));

const { studyGoalsRoutes } = await import('../../routes/learning/study-goals');

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const method of Object.values(model)) {
      if (typeof method === 'function' && 'mockReset' in method) {
        (method as ReturnType<typeof mock>).mockReset();
      }
    }
  }
}

function createApp() {
  return new Elysia().use(studyGoalsRoutes);
}

describe('PATCH /study-goals/:id (themeId)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('themeIdを設定すると永続化されること', async () => {
    mockPrisma.studyGoal.update.mockResolvedValue({ id: 1, themeId: 5 });

    const res = await app.handle(
      new Request('http://localhost/study-goals/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeId: 5 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.themeId).toBe(5);
    const updateCall = mockPrisma.studyGoal.update.mock.calls[0]![0] as {
      data: { themeId: number };
    };
    expect(updateCall.data.themeId).toBe(5);
  });

  test('themeId:nullで紐づけを解除できること', async () => {
    mockPrisma.studyGoal.update.mockResolvedValue({ id: 1, themeId: null });

    const res = await app.handle(
      new Request('http://localhost/study-goals/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeId: null }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.themeId).toBeNull();
    const updateCall = mockPrisma.studyGoal.update.mock.calls[0]![0] as {
      data: { themeId: number | null };
    };
    expect(updateCall.data.themeId).toBeNull();
  });

  test('themeIdを含まないPATCHはthemeIdを更新しないこと', async () => {
    mockPrisma.studyGoal.update.mockResolvedValue({ id: 1, title: '更新後' });

    await app.handle(
      new Request('http://localhost/study-goals/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '更新後' }),
      }),
    );

    const updateCall = mockPrisma.studyGoal.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect('themeId' in updateCall.data).toBe(false);
  });
});
