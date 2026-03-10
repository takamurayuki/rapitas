/**
 * Learning Goals Routes テスト
 * 学習目標APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  learningGoal: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  category: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  theme: {
    create: mock(() => Promise.resolve({ id: 1, name: 'テーマ' })),
  },
  task: {
    create: mock(() => Promise.resolve({ id: 1, title: 'タスク' })),
  },
};

const mockSendAIMessage = mock(() => Promise.resolve({ content: '{}', tokensUsed: 100 }));
const mockGetDefaultProvider = mock(() => Promise.resolve('claude'));
const mockIsAnyApiKeyConfigured = mock(() => Promise.resolve(true));

mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
  getDefaultProvider: mockGetDefaultProvider,
  isAnyApiKeyConfigured: mockIsAnyApiKeyConfigured,
}));

const { learningGoalsRoutes } = await import('../../../routes/learning/learning-goals');

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
  mockSendAIMessage.mockReset();
  mockGetDefaultProvider.mockReset();
  mockIsAnyApiKeyConfigured.mockReset();

  mockGetDefaultProvider.mockResolvedValue('claude');
  mockIsAnyApiKeyConfigured.mockResolvedValue(true);
}

function createApp() {
  return new Elysia().use(learningGoalsRoutes);
}

describe('GET /learning-goals', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全学習目標を返すこと', async () => {
    const goals = [
      { id: 1, title: 'TypeScript学習', status: 'active' },
      { id: 2, title: 'React学習', status: 'active' },
    ];
    mockPrisma.learningGoal.findMany.mockResolvedValue(goals);

    const res = await app.handle(new Request('http://localhost/learning-goals'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  test('空配列を返すこと', async () => {
    mockPrisma.learningGoal.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/learning-goals'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('GET /learning-goals/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('IDで学習目標を取得すること', async () => {
    const goal = { id: 1, title: 'TypeScript学習', currentLevel: '初級' };
    mockPrisma.learningGoal.findUnique.mockResolvedValue(goal);

    const res = await app.handle(new Request('http://localhost/learning-goals/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.title).toBe('TypeScript学習');
  });
});

describe('POST /learning-goals', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('学習目標を作成すること', async () => {
    const created = { id: 1, title: '新しい目標' };
    mockPrisma.learningGoal.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/learning-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新しい目標' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('新しい目標');
  });

  test('タイトルなしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/learning-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });

  test('オプションフィールド付きで作成できること', async () => {
    const created = {
      id: 1,
      title: '目標',
      description: '説明',
      currentLevel: '初級',
      targetLevel: '中級',
      dailyHours: 2,
    };
    mockPrisma.learningGoal.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/learning-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '目標',
          description: '説明',
          currentLevel: '初級',
          targetLevel: '中級',
          dailyHours: 2,
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('目標');
  });
});

describe('PATCH /learning-goals/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('学習目標を更新すること', async () => {
    const updated = { id: 1, title: '更新された目標', status: 'active' };
    mockPrisma.learningGoal.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/learning-goals/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '更新された目標' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('更新された目標');
  });

  test('ステータスを更新できること', async () => {
    const updated = { id: 1, title: '目標', status: 'completed' };
    mockPrisma.learningGoal.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/learning-goals/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('completed');
  });
});

describe('DELETE /learning-goals/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('学習目標を削除すること', async () => {
    const deleted = { id: 1, title: '削除対象' };
    mockPrisma.learningGoal.delete.mockResolvedValue(deleted);

    const res = await app.handle(
      new Request('http://localhost/learning-goals/1', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });
});

describe('POST /learning-goals/:id/generate-plan', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('学習目標が見つからない場合エラーを返すこと', async () => {
    mockPrisma.learningGoal.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/learning-goals/999/generate-plan', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(body.error).toBeDefined();
  });

  test('AI未設定時にフォールバックプランを返すこと', async () => {
    const goal = {
      id: 1,
      title: 'TypeScript学習',
      currentLevel: '初級',
      targetLevel: '中級',
      deadline: null,
      dailyHours: 2,
    };
    mockPrisma.learningGoal.findUnique.mockResolvedValue(goal);
    mockIsAnyApiKeyConfigured.mockResolvedValue(false);
    mockPrisma.learningGoal.update.mockResolvedValue({});

    const res = await app.handle(
      new Request('http://localhost/learning-goals/1/generate-plan', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('fallback');
    expect(body.plan).toBeDefined();
  });

  test('AI設定済み時にAI生成プランを返すこと', async () => {
    const goal = {
      id: 1,
      title: 'TypeScript学習',
      currentLevel: '初級',
      targetLevel: '中級',
      deadline: null,
      dailyHours: 2,
    };
    mockPrisma.learningGoal.findUnique.mockResolvedValue(goal);
    mockIsAnyApiKeyConfigured.mockResolvedValue(true);
    mockSendAIMessage.mockResolvedValue({
      content: '{"phases": [], "tips": []}',
      tokensUsed: 200,
    });
    mockPrisma.learningGoal.update.mockResolvedValue({});

    const res = await app.handle(
      new Request('http://localhost/learning-goals/1/generate-plan', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('ai');
    expect(body.plan).toBeDefined();
  });
});

describe('POST /learning-goals/:id/apply', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('学習目標が見つからない場合エラーを返すこと', async () => {
    mockPrisma.learningGoal.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/learning-goals/999/apply', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(body.error).toBeDefined();
  });

  test('生成プランがない場合エラーを返すこと', async () => {
    const goal = { id: 1, title: 'テスト', generatedPlan: null, isApplied: false };
    mockPrisma.learningGoal.findUnique.mockResolvedValue(goal);

    const res = await app.handle(
      new Request('http://localhost/learning-goals/1/apply', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(body.error).toContain('No generated plan');
  });

  test('既に適用済みの場合エラーを返すこと', async () => {
    const goal = {
      id: 1,
      title: 'テスト',
      generatedPlan: '{}',
      isApplied: true,
    };
    mockPrisma.learningGoal.findUnique.mockResolvedValue(goal);

    const res = await app.handle(
      new Request('http://localhost/learning-goals/1/apply', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(body.error).toContain('already been applied');
  });

  test('プランを正常に適用できること', async () => {
    const plan = {
      themeName: 'TS学習',
      themeDescription: 'TypeScript学習',
      phases: [
        {
          name: '基礎',
          days: 30,
          tasks: [
            {
              title: '基本学習',
              description: 'TypeScript基礎',
              estimatedHours: 10,
              priority: 'high',
            },
          ],
        },
      ],
    };
    const goal = {
      id: 1,
      title: 'TypeScript学習',
      description: 'TypeScript desc',
      generatedPlan: JSON.stringify(plan),
      isApplied: false,
      categoryId: null,
      dailyHours: 2,
    };
    mockPrisma.learningGoal.findUnique.mockResolvedValue(goal);
    mockPrisma.category.findFirst.mockResolvedValue({ id: 1 });
    mockPrisma.theme.create.mockResolvedValue({ id: 10, name: 'TS学習' });
    mockPrisma.task.create.mockResolvedValue({ id: 1, title: '基本学習' });
    mockPrisma.learningGoal.update.mockResolvedValue({});

    const res = await app.handle(
      new Request('http://localhost/learning-goals/1/apply', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.themeId).toBe(10);
    expect(body.createdTaskCount).toBe(1);
  });
});
