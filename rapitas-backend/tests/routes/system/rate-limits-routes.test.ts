/**
 * Rate Limits Routes テスト
 * レート制限・使用状況情報取得のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  agentExecution: {
    findMany: mock(() => Promise.resolve([])),
  },
  copilotMessage: {
    count: mock(() => Promise.resolve(0)),
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

const { rateLimitRoutes } = await import('../../../routes/system/monitoring/rate-limits');

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
  mockPrisma.agentExecution.findMany.mockResolvedValue([]);
  mockPrisma.copilotMessage.count.mockResolvedValue(0);
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
    .use(rateLimitRoutes);
}

describe('GET /rate-limits/', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('実行がない場合に空のusageDataを返すこと', async () => {
    mockPrisma.agentExecution.findMany.mockResolvedValue([]);
    mockPrisma.copilotMessage.count.mockResolvedValue(0);

    const res = await app.handle(new Request('http://localhost/rate-limits/'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.usageData).toBeDefined();
    expect(Array.isArray(body.usageData)).toBe(true);
    expect(body.usageData.length).toBe(0);
  });

  test('エージェント実行がある場合に使用情報を返すこと', async () => {
    mockPrisma.agentExecution.findMany.mockResolvedValue([
      {
        tokensUsed: 1000,
        executionTimeMs: 5000,
        command: 'test command',
        agentConfig: { agentType: 'claude-code', modelId: 'claude-sonnet-4-6' },
      },
    ]);
    mockPrisma.copilotMessage.count.mockResolvedValue(0);

    const res = await app.handle(new Request('http://localhost/rate-limits/'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.usageData).toBeDefined();
    expect(Array.isArray(body.usageData)).toBe(true);
    expect(body.usageData.length).toBe(1);
    expect(body.usageData[0].provider).toBe('claude');
  });

  test('使用情報に必須フィールドが含まれること', async () => {
    mockPrisma.agentExecution.findMany.mockResolvedValue([
      {
        tokensUsed: 1000,
        executionTimeMs: 5000,
        command: 'test command',
        agentConfig: { agentType: 'claude-code', modelId: 'claude-sonnet-4-6' },
      },
    ]);
    mockPrisma.copilotMessage.count.mockResolvedValue(0);

    const res = await app.handle(new Request('http://localhost/rate-limits/'));
    const body = await res.json();

    const usage = body.usageData[0];
    expect(usage.provider).toBeDefined();
    expect(usage.plan).toBeDefined();
    expect(typeof usage.tokensUsed).toBe('number');
    expect(typeof usage.estimatedCost).toBe('number');
    expect(typeof usage.executionCount).toBe('number');
    expect(usage.period).toBeDefined();
    expect(usage.lastUpdated).toBeDefined();
    expect(usage.dataSource).toBeDefined();
  });
});
