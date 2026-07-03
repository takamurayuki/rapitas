/**
 * Task Analysis Config Routes テスト
 * タスク解析設定の取得・作成・更新・削除・デフォルト値取得のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  taskAnalysisConfig: {
    findUnique: mock(() => Promise.resolve(null)),
    upsert: mock(() => Promise.resolve({})),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  task: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  aIAgentConfig: {
    findUnique: mock(() => Promise.resolve(null)),
  },
};

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { taskAnalysisConfigRoutes } = await import('../../../routes/tasks/task-analysis-config');

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const method of Object.values(model)) {
      (method as ReturnType<typeof mock>).mockReset();
    }
  }
  mockPrisma.taskAnalysisConfig.findUnique.mockResolvedValue(null);
  mockPrisma.task.findUnique.mockResolvedValue(null);
  mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(null);
}

function createApp() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Server error' };
    })
    .use(taskAnalysisConfigRoutes);
}

describe('GET /task-analysis-config/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('設定が存在すれば200で返すこと', async () => {
    const config = { id: 1, taskId: 5, analysisDepth: 'standard', agentConfig: null };
    mockPrisma.taskAnalysisConfig.findUnique.mockResolvedValue(config);

    const res = await app.handle(new Request('http://localhost/task-analysis-config/5'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.taskId).toBe(5);
    const call = mockPrisma.taskAnalysisConfig.findUnique.mock.calls[0]![0] as {
      where: { taskId: number };
    };
    expect(call.where.taskId).toBe(5);
  });

  test('設定が存在しなければ404を返すこと', async () => {
    mockPrisma.taskAnalysisConfig.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/task-analysis-config/999'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Task analysis config not found');
  });
});

describe('PUT /task-analysis-config/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('タスクが存在しなければ404を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisDepth: 'deep' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Task not found');
    expect(mockPrisma.taskAnalysisConfig.upsert).not.toHaveBeenCalled();
  });

  test('agentConfigIdが存在しなければ400を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 5 });
    mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentConfigId: 42 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Agent config not found');
    expect(mockPrisma.taskAnalysisConfig.upsert).not.toHaveBeenCalled();
  });

  test('未知のenum値は型レベル検証で422を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 5 });

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisDepth: 'ultra' }),
      }),
    );

    // analysisDepthSchema (t.Union of literals) rejects this before the
    // handler's manual `.includes()` check ever runs.
    expect(res.status).toBe(422);
  });

  test('範囲外のtemperatureは型レベル検証で422を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 5 });

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temperature: 5 }),
      }),
    );

    expect(res.status).toBe(422);
  });

  test('新規作成時にデフォルト値を含めてupsertすること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 5 });
    const created = { id: 1, taskId: 5, analysisDepth: 'standard', agentConfig: null };
    mockPrisma.taskAnalysisConfig.upsert.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.taskId).toBe(5);
    const call = mockPrisma.taskAnalysisConfig.upsert.mock.calls[0]![0] as {
      where: { taskId: number };
      create: { analysisDepth: string; maxSubtasks: number; promptStrategy: string };
      update: Record<string, unknown>;
    };
    expect(call.where.taskId).toBe(5);
    expect(call.create.analysisDepth).toBe('standard');
    expect(call.create.maxSubtasks).toBe(10);
    expect(call.create.promptStrategy).toBe('auto');
    expect(Object.keys(call.update).length).toBe(0);
  });

  test('明示的なnullでオーバーライドをクリアできること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 5 });
    mockPrisma.taskAnalysisConfig.upsert.mockResolvedValue({ id: 1, taskId: 5 });

    await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temperature: null, modelOverride: null }),
      }),
    );

    const call = mockPrisma.taskAnalysisConfig.upsert.mock.calls[0]![0] as {
      update: { temperature: number | null; modelOverride: string | null };
    };
    expect(call.update.temperature).toBeNull();
    expect(call.update.modelOverride).toBeNull();
  });

  test('有効なagentConfigIdを指定して更新すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 5 });
    mockPrisma.aIAgentConfig.findUnique.mockResolvedValue({ id: 42, agentType: 'claude' });
    mockPrisma.taskAnalysisConfig.upsert.mockResolvedValue({ id: 1, taskId: 5, agentConfigId: 42 });

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentConfigId: 42, analysisDepth: 'deep' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agentConfigId).toBe(42);
    const call = mockPrisma.taskAnalysisConfig.upsert.mock.calls[0]![0] as {
      update: { agentConfigId: number; analysisDepth: string };
    };
    expect(call.update.agentConfigId).toBe(42);
    expect(call.update.analysisDepth).toBe('deep');
  });

  test('未定義のプロパティは無視されて処理が継続すること', async () => {
    // NOTE: Elysia's TypeBox compiler strips unknown properties rather than
    // rejecting them, even with `additionalProperties: false` — verified
    // empirically (not a bug in the route; documenting actual behavior).
    mockPrisma.task.findUnique.mockResolvedValue({ id: 5 });
    mockPrisma.taskAnalysisConfig.upsert.mockResolvedValue({ id: 1, taskId: 5 });

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notAField: 'x' }),
      }),
    );

    expect(res.status).toBe(200);
  });

  test('無効なtaskIdはNaNとしてPrismaへ渡ること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/abc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(404);
    const call = mockPrisma.task.findUnique.mock.calls[0]![0] as { where: { id: number } };
    expect(Number.isNaN(call.where.id)).toBe(true);
  });
});

describe('PATCH /task-analysis-config/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('設定が存在しなければ404を返すこと', async () => {
    mockPrisma.taskAnalysisConfig.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisDepth: 'deep' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Task analysis config not found. Use PUT to create.');
    expect(mockPrisma.taskAnalysisConfig.update).not.toHaveBeenCalled();
  });

  test('存在する設定を部分更新すること', async () => {
    mockPrisma.taskAnalysisConfig.findUnique.mockResolvedValue({ id: 1, taskId: 5 });
    mockPrisma.taskAnalysisConfig.update.mockResolvedValue({
      id: 1,
      taskId: 5,
      analysisDepth: 'quick',
    });

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisDepth: 'quick' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysisDepth).toBe('quick');
    const call = mockPrisma.taskAnalysisConfig.update.mock.calls[0]![0] as {
      where: { taskId: number };
      data: { analysisDepth?: string };
    };
    expect(call.where.taskId).toBe(5);
    expect(call.data.analysisDepth).toBe('quick');
    expect(Object.keys(call.data).length).toBe(1);
  });

  test('範囲外のtemperatureは型レベル検証で422を返すこと', async () => {
    mockPrisma.taskAnalysisConfig.findUnique.mockResolvedValue({ id: 1, taskId: 5 });

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temperature: -1 }),
      }),
    );

    expect(res.status).toBe(422);
    expect(mockPrisma.taskAnalysisConfig.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /task-analysis-config/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('設定が存在すれば削除して成功を返すこと', async () => {
    mockPrisma.taskAnalysisConfig.findUnique.mockResolvedValue({ id: 1, taskId: 5 });
    mockPrisma.taskAnalysisConfig.delete.mockResolvedValue({ id: 1, taskId: 5 });

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/5', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockPrisma.taskAnalysisConfig.delete).toHaveBeenCalledWith({ where: { taskId: 5 } });
  });

  test('設定が存在しなければ404を返すこと', async () => {
    mockPrisma.taskAnalysisConfig.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/999', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Task analysis config not found');
    expect(mockPrisma.taskAnalysisConfig.delete).not.toHaveBeenCalled();
  });
});

describe('GET /task-analysis-config/defaults/values', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('デフォルト値一式を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/task-analysis-config/defaults/values'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      analysisDepth: 'standard',
      maxSubtasks: 10,
      priorityStrategy: 'balanced',
      includeEstimates: true,
      includeDependencies: true,
      includeTips: true,
      promptStrategy: 'auto',
      autoApproveSubtasks: false,
      autoOptimizePrompt: false,
      notifyOnComplete: true,
    });
  });
});
