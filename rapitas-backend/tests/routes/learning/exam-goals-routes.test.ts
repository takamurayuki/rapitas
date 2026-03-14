/**
 * Exam Goals Routes テスト
 * 試験目標APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  examGoal: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
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

const { examGoalsRoutes } = await import('../../../routes/learning/exam-goals');
const { ValidationError } = await import('../../../middleware/error-handler');

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
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (error instanceof ValidationError) {
        set.status = error.statusCode;
        return { error: error.message };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return {
        error: error instanceof Error ? error.message : 'Server error',
      };
    })
    .use(examGoalsRoutes);
}

describe('GET /exam-goals', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全試験目標を返すこと', async () => {
    const goals = [
      { id: 1, name: 'TOEIC', examDate: '2026-06-01', _count: { tasks: 3 } },
      { id: 2, name: 'JLPT N1', examDate: '2026-07-01', _count: { tasks: 5 } },
    ];
    mockPrisma.examGoal.findMany.mockResolvedValue(goals);

    const res = await app.handle(new Request('http://localhost/exam-goals'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  test('空配列を返すこと', async () => {
    mockPrisma.examGoal.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/exam-goals'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('GET /exam-goals/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('IDで試験目標を取得すること', async () => {
    const goal = {
      id: 1,
      name: 'TOEIC',
      examDate: '2026-06-01',
      tasks: [],
    };
    mockPrisma.examGoal.findUnique.mockResolvedValue(goal);

    const res = await app.handle(new Request('http://localhost/exam-goals/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.name).toBe('TOEIC');
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/exam-goals/abc'));

    expect(res.status).toBe(400);
  });
});

describe('POST /exam-goals', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('試験目標を作成すること', async () => {
    const created = {
      id: 1,
      name: 'TOEIC',
      examDate: '2026-06-01T00:00:00.000Z',
    };
    mockPrisma.examGoal.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/exam-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'TOEIC', examDate: '2026-06-01' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('TOEIC');
  });

  test('名前なしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/exam-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examDate: '2026-06-01' }),
      }),
    );

    expect(res.status).toBe(422);
  });

  test('オプションフィールド付きで作成できること', async () => {
    const created = {
      id: 1,
      name: 'TOEIC',
      examDate: '2026-06-01T00:00:00.000Z',
      description: '900点目標',
      targetScore: '900',
      color: '#FF0000',
    };
    mockPrisma.examGoal.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/exam-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'TOEIC',
          examDate: '2026-06-01',
          description: '900点目標',
          targetScore: '900',
          color: '#FF0000',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('TOEIC');
    expect(body.targetScore).toBe('900');
  });
});

describe('PATCH /exam-goals/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('試験目標を更新すること', async () => {
    const updated = { id: 1, name: 'TOEIC 900点', targetScore: '900' };
    mockPrisma.examGoal.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/exam-goals/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'TOEIC 900点', targetScore: '900' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('TOEIC 900点');
  });

  test('完了状態を更新できること', async () => {
    const updated = { id: 1, name: 'TOEIC', isCompleted: true, actualScore: '920' };
    mockPrisma.examGoal.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/exam-goals/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: true, actualScore: '920' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isCompleted).toBe(true);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/exam-goals/abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe('DELETE /exam-goals/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('試験目標を削除すること', async () => {
    const deleted = { id: 1, name: 'TOEIC' };
    mockPrisma.examGoal.delete.mockResolvedValue(deleted);

    const res = await app.handle(
      new Request('http://localhost/exam-goals/1', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/exam-goals/abc', { method: 'DELETE' }),
    );

    expect(res.status).toBe(400);
  });
});
