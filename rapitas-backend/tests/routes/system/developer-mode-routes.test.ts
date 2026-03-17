/**
 * Developer Mode Routes テスト
 * 開発者モード設定・セッション管理のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  developerModeConfig: {
    findUnique: mock(() => Promise.resolve(null)),
    findUniqueOrThrow: mock(() => Promise.resolve({ id: 1, taskId: 1, isEnabled: true })),
    upsert: mock(() => Promise.resolve({ id: 1, taskId: 1, isEnabled: true })),
    update: mock(() => Promise.resolve({})),
  },
  task: {
    update: mock(() => Promise.resolve({})),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 10 })),
    findMany: mock(() => Promise.resolve([])),
  },
  agentSession: {
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    findMany: mock(() => Promise.resolve([])),
  },
  agentAction: {
    create: mock(() => Promise.resolve({})),
  },
  approvalRequest: {
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  notification: {
    create: mock(() => Promise.resolve({})),
  },
  taskPrompt: {
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  $transaction: mock((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)),
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
mock.module('../../../services/claude-agent', () => ({
  analyzeTask: mock(() =>
    Promise.resolve({
      result: {
        summary: 'test',
        suggestedSubtasks: [],
        reasoning: 'test',
        tips: [],
        complexity: 'low',
        estimatedTotalHours: 1,
      },
      tokensUsed: 100,
    }),
  ),
  generateOptimizedPrompt: mock(() =>
    Promise.resolve({
      result: {
        optimizedPrompt: 'test',
        structuredSections: {
          objective: '',
          context: '',
          requirements: [],
          constraints: [],
          deliverables: [],
        },
        promptQuality: { score: 80, issues: [], suggestions: [] },
      },
      tokensUsed: 50,
    }),
  ),
  formatPromptForAgent: mock(() => 'formatted prompt'),
  generateBranchName: mock(() => Promise.resolve({ branchName: 'feature/test' })),
  generateTaskTitle: mock(() => Promise.resolve({ title: 'Generated Title' })),
}));
mock.module('../../../utils/ai-client', () => ({
  getDefaultProvider: mock(() => Promise.resolve('anthropic-api')),
  getApiKeyForProvider: mock(() => Promise.resolve('sk-test-key')),
}));
mock.module('../../../utils/db-helpers', () => ({
  getLabelsArray: mock(() => []),
  toJsonString: mock((v: unknown) => JSON.stringify(v)),
  fromJsonString: mock((v: string) => JSON.parse(v)),
}));

const { developerModeRoutes } = await import('../../../routes/system/developer-mode');

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
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return {
        error: error instanceof Error ? error.message : 'Server error',
      };
    })
    .use(developerModeRoutes);
}

describe('GET /developer-mode/config/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('設定が存在する場合に設定を返すこと', async () => {
    const config = {
      id: 1,
      taskId: 1,
      isEnabled: true,
      autoApprove: false,
      maxSubtasks: 10,
      priority: 'balanced',
      agentSessions: [],
      approvalRequests: [],
    };
    mockPrisma.developerModeConfig.findUnique.mockResolvedValue(config);

    const res = await app.handle(new Request('http://localhost/developer-mode/config/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.isEnabled).toBe(true);
    expect(body.taskId).toBe(1);
  });

  test('設定が存在しない場合にnullを返すこと', async () => {
    mockPrisma.developerModeConfig.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/developer-mode/config/1'));

    expect(res.status).toBe(200);
    const text = await res.text();
    // Elysia returns empty body or "null" for null responses
    expect(text === '' || text === 'null').toBe(true);
  });
});

describe('POST /developer-mode/enable/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('開発者モードを有効化すること', async () => {
    const config = {
      id: 1,
      taskId: 1,
      isEnabled: true,
      autoApprove: false,
      maxSubtasks: 10,
      priority: 'balanced',
    };
    mockPrisma.task.update.mockResolvedValue({});
    mockPrisma.developerModeConfig.upsert.mockResolvedValue(config);

    const res = await app.handle(
      new Request('http://localhost/developer-mode/enable/1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoApprove: false, maxSubtasks: 10 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isEnabled).toBe(true);
    expect(mockPrisma.task.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.developerModeConfig.upsert).toHaveBeenCalledTimes(1);
  });

  test('P2002 race condition時にupdateにフォールバックすること', async () => {
    const p2002Error = new Error('Unique constraint failed on the fields: (`taskId`)');
    Object.assign(p2002Error, {
      code: 'P2002',
      name: 'PrismaClientKnownRequestError',
      meta: { target: ['taskId'] },
    });
    const config = {
      id: 1,
      taskId: 1,
      isEnabled: true,
      autoApprove: false,
      maxSubtasks: 10,
      priority: 'balanced',
    };
    mockPrisma.task.update.mockResolvedValue({});
    mockPrisma.developerModeConfig.upsert.mockRejectedValue(p2002Error);
    mockPrisma.developerModeConfig.update.mockResolvedValue(config);

    const res = await app.handle(
      new Request('http://localhost/developer-mode/enable/1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoApprove: false, maxSubtasks: 10 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isEnabled).toBe(true);
    expect(mockPrisma.developerModeConfig.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.developerModeConfig.update).toHaveBeenCalledTimes(1);
  });

  test('autoApproveオプション付きで有効化すること', async () => {
    const config = {
      id: 1,
      taskId: 1,
      isEnabled: true,
      autoApprove: true,
      maxSubtasks: 5,
      priority: 'aggressive',
    };
    mockPrisma.task.update.mockResolvedValue({});
    mockPrisma.developerModeConfig.upsert.mockResolvedValue(config);

    const res = await app.handle(
      new Request('http://localhost/developer-mode/enable/1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoApprove: true,
          maxSubtasks: 5,
          priority: 'aggressive',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.autoApprove).toBe(true);
    expect(body.priority).toBe('aggressive');
  });

  test('P2002エラーが発生した場合にfindUnique + updateで復旧すること', async () => {
    const existingConfig = {
      id: 1,
      taskId: 1,
      isEnabled: false,
      autoApprove: false,
      maxSubtasks: 10,
      priority: 'balanced',
    };
    const updatedConfig = {
      id: 1,
      taskId: 1,
      isEnabled: true,
      autoApprove: true,
      maxSubtasks: 5,
      priority: 'aggressive',
    };

    mockPrisma.task.update.mockResolvedValue({});

    // Simulate P2002 error on upsert
    const p2002Error = new Error('Unique constraint failed');
    (p2002Error as any).code = 'P2002';
    (p2002Error as any).meta = { target: ['taskId'] };

    mockPrisma.developerModeConfig.upsert.mockRejectedValue(p2002Error);
    mockPrisma.developerModeConfig.findUniqueOrThrow.mockResolvedValue(existingConfig);
    mockPrisma.developerModeConfig.update.mockResolvedValue(updatedConfig);

    const res = await app.handle(
      new Request('http://localhost/developer-mode/enable/1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoApprove: true,
          maxSubtasks: 5,
          priority: 'aggressive',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.autoApprove).toBe(true);
    expect(body.priority).toBe('aggressive');
    expect(mockPrisma.developerModeConfig.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.developerModeConfig.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(mockPrisma.developerModeConfig.update).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /developer-mode/disable/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('開発者モードを無効化して成功を返すこと', async () => {
    const config = { id: 1, taskId: 1, isEnabled: true };
    mockPrisma.task.update.mockResolvedValue({});
    mockPrisma.developerModeConfig.findUnique.mockResolvedValue(config);
    mockPrisma.developerModeConfig.update.mockResolvedValue({
      ...config,
      isEnabled: false,
    });

    const res = await app.handle(
      new Request('http://localhost/developer-mode/disable/1', {
        method: 'DELETE',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockPrisma.task.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.developerModeConfig.update).toHaveBeenCalledTimes(1);
  });

  test('設定が存在しない場合でも成功を返すこと', async () => {
    mockPrisma.task.update.mockResolvedValue({});
    mockPrisma.developerModeConfig.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/developer-mode/disable/1', {
        method: 'DELETE',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockPrisma.developerModeConfig.update).not.toHaveBeenCalled();
  });
});

describe('PATCH /developer-mode/config/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('設定を更新すること', async () => {
    const updated = {
      id: 1,
      taskId: 1,
      isEnabled: true,
      autoApprove: true,
      maxSubtasks: 15,
      priority: 'aggressive',
    };
    mockPrisma.developerModeConfig.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/developer-mode/config/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoApprove: true,
          maxSubtasks: 15,
          priority: 'aggressive',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.autoApprove).toBe(true);
    expect(body.maxSubtasks).toBe(15);
    expect(mockPrisma.developerModeConfig.update).toHaveBeenCalledTimes(1);
  });

  test('部分的な更新ができること', async () => {
    const updated = {
      id: 1,
      taskId: 1,
      isEnabled: true,
      autoApprove: false,
      notifyInApp: true,
      maxSubtasks: 10,
      priority: 'balanced',
    };
    mockPrisma.developerModeConfig.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/developer-mode/config/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyInApp: true }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notifyInApp).toBe(true);
  });
});

describe('GET /developer-mode/sessions/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('設定が存在しない場合に空配列を返すこと', async () => {
    mockPrisma.developerModeConfig.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/developer-mode/sessions/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test('設定が存在する場合にセッション一覧を返すこと', async () => {
    const config = { id: 5, taskId: 1, isEnabled: true };
    const sessions = [
      {
        id: 1,
        configId: 5,
        status: 'completed',
        startedAt: new Date().toISOString(),
        agentActions: [],
      },
      {
        id: 2,
        configId: 5,
        status: 'running',
        startedAt: new Date().toISOString(),
        agentActions: [],
      },
    ];
    mockPrisma.developerModeConfig.findUnique.mockResolvedValue(config);
    mockPrisma.agentSession.findMany.mockResolvedValue(sessions);

    const res = await app.handle(new Request('http://localhost/developer-mode/sessions/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].configId).toBe(5);
  });
});

describe('POST /developer-mode/generate-title', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('説明からタイトルを生成すること', async () => {
    const res = await app.handle(
      new Request('http://localhost/developer-mode/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'ユーザー認証機能をJWTを使って実装する',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('Generated Title');
  });

  test('説明文が空の場合に400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/developer-mode/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: '' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });
});
