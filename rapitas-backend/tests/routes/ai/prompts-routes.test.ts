/**
 * Prompts Routes テスト
 * プロンプトCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  taskPrompt: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
};

const mockGenerateOptimizedPrompt = mock(() =>
  Promise.resolve({
    result: {
      optimizedPrompt: 'optimized',
      structuredSections: {},
      promptQuality: { score: 85 },
    },
  }),
);

mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../../services/claude-agent', () => ({
  generateOptimizedPrompt: mockGenerateOptimizedPrompt,
}));
mock.module('../../../utils/ai-client', () => ({
  getDefaultProvider: mock(() => Promise.resolve('claude')),
  getApiKeyForProvider: mock(() => Promise.resolve('sk-test-key')),
}));
mock.module('../../../utils/db-helpers', () => ({
  getLabelsArray: mock(() => []),
  toJsonString: mock((v: unknown) => JSON.stringify(v)),
}));

const { promptsRoutes } = await import('../../../routes/ai/prompts');

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
  return new Elysia().use(promptsRoutes);
}

describe('GET /tasks/:id/prompts', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('タスクのプロンプト一覧を返すこと', async () => {
    const task = {
      id: 1,
      title: 'テストタスク',
      description: '説明',
      subtasks: [{ id: 2, title: 'サブタスク1' }],
    };
    const prompts = [{ id: 1, taskId: 1, optimizedPrompt: 'prompt1' }];
    mockPrisma.task.findUnique.mockResolvedValue(task);
    mockPrisma.taskPrompt.findMany.mockResolvedValue(prompts);

    const res = await app.handle(new Request('http://localhost/tasks/1/prompts'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.task).toBeDefined();
    expect(body.task.id).toBe(1);
    expect(body.prompts).toBeDefined();
  });

  test('タスクが見つからない場合エラーを返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/tasks/999/prompts'));
    const body = await res.json();

    expect(body.error).toBeDefined();
  });
});

describe('POST /tasks/:id/prompts', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('プロンプトを作成すること', async () => {
    const created = {
      id: 1,
      taskId: 1,
      optimizedPrompt: 'test prompt',
      isActive: true,
    };
    mockPrisma.taskPrompt.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/tasks/1/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optimizedPrompt: 'test prompt' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.optimizedPrompt).toBe('test prompt');
  });

  test('optimizedPromptなしで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/1/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });
});

describe('PATCH /prompts/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('プロンプトを更新すること', async () => {
    const existing = { id: 1, optimizedPrompt: 'old' };
    const updated = { id: 1, optimizedPrompt: 'new', name: 'updated' };
    mockPrisma.taskPrompt.findUnique.mockResolvedValue(existing);
    mockPrisma.taskPrompt.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/prompts/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated', optimizedPrompt: 'new' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('updated');
  });

  test('存在しないIDで404を返すこと', async () => {
    mockPrisma.taskPrompt.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/prompts/999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });
});

describe('DELETE /prompts/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('プロンプトを削除すること', async () => {
    const existing = { id: 1, optimizedPrompt: 'test' };
    mockPrisma.taskPrompt.findUnique.mockResolvedValue(existing);
    mockPrisma.taskPrompt.delete.mockResolvedValue(existing);

    const res = await app.handle(new Request('http://localhost/prompts/1', { method: 'DELETE' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test('存在しないIDで404を返すこと', async () => {
    mockPrisma.taskPrompt.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/prompts/999', { method: 'DELETE' }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });
});

describe('POST /tasks/:id/prompts/generate-all', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('タスクが見つからない場合404を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/tasks/999/prompts/generate-all', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });

  test('サブタスクなしのタスクで一括生成できること', async () => {
    const task = {
      id: 1,
      title: 'テスト',
      description: 'desc',
      priority: 'medium',
      labels: '[]',
      subtasks: [],
    };
    mockPrisma.task.findUnique.mockResolvedValue(task);
    mockGenerateOptimizedPrompt.mockResolvedValue({
      result: {
        optimizedPrompt: 'optimized',
        structuredSections: {},
        promptQuality: { score: 85 },
      },
    });
    mockPrisma.taskPrompt.create.mockResolvedValue({ id: 1 });

    const res = await app.handle(
      new Request('http://localhost/tasks/1/prompts/generate-all', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.taskId).toBe(1);
    expect(body.results).toBeDefined();
  });
});
