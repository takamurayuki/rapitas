/**
 * Rate Limits Routes テスト
 * レート制限情報取得のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  userSettings: {
    findFirst: mock(() => Promise.resolve(null)),
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
mock.module('../../../utils/ai-client', () => ({
  getApiKeyForProvider: mock(() => Promise.resolve(null)),
}));
mock.module('../../../utils/common/encryption', () => ({
  decrypt: mock((v: string) => `decrypted:${v}`),
}));

const { rateLimitRoutes } = await import('../../../routes/system/rate-limits');
const { getApiKeyForProvider } = await import('../../../utils/ai-client');

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
  (getApiKeyForProvider as ReturnType<typeof mock>).mockReset();
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

  test('APIキーが設定されていない場合に空のrateLimitsを返すこと', async () => {
    (getApiKeyForProvider as ReturnType<typeof mock>).mockResolvedValue(null);
    mockPrisma.userSettings.findFirst.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/rate-limits/'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rateLimits).toBeDefined();
    expect(Array.isArray(body.rateLimits)).toBe(true);
    expect(body.rateLimits.length).toBe(0);
  });

  test('ClaudeのAPIキーが設定されている場合にClaudeのレート制限情報を返すこと', async () => {
    (getApiKeyForProvider as ReturnType<typeof mock>).mockImplementation((provider: string) => {
      if (provider === 'claude') return Promise.resolve('sk-claude-key');
      return Promise.resolve(null);
    });
    mockPrisma.userSettings.findFirst.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/rate-limits/'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rateLimits).toBeDefined();
    expect(Array.isArray(body.rateLimits)).toBe(true);
    expect(body.rateLimits.length).toBe(1);
    expect(body.rateLimits[0].provider).toBe('claude');
    expect(body.rateLimits[0].isMockData).toBe(true);
    expect(body.rateLimits[0].dataSource).toBe('mock');
  });

  test('レート制限情報に必須フィールドが含まれること', async () => {
    (getApiKeyForProvider as ReturnType<typeof mock>).mockImplementation((provider: string) => {
      if (provider === 'claude') return Promise.resolve('sk-claude-key');
      return Promise.resolve(null);
    });
    mockPrisma.userSettings.findFirst.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/rate-limits/'));
    const body = await res.json();

    const rateLimit = body.rateLimits[0];
    expect(rateLimit.provider).toBeDefined();
    expect(rateLimit.plan).toBeDefined();
    expect(typeof rateLimit.used).toBe('number');
    expect(typeof rateLimit.limit).toBe('number');
    expect(rateLimit.period).toBeDefined();
    expect(rateLimit.lastUpdated).toBeDefined();
    expect(rateLimit.reliability).toBeDefined();
  });
});
