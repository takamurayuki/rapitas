/**
 * settings-auto-run-concurrency.test
 *
 * PATCH /settings clamps autoRunMaxConcurrency to 1..4 before persisting it,
 * and GET/PATCH /settings report whether the AUTO_RUN_GLOBAL_MAX_CONCURRENCY
 * env var currently overrides the saved value (task 1543).
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  userSettings: {
    findFirst: mock(() => Promise.resolve(null as Record<string, unknown> | null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock((_args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 1 } as Record<string, unknown>),
    ),
  },
};

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../../utils/common/encryption', () => ({
  encrypt: (value: string) => `encrypted_${value}`,
  decrypt: (value: string) => value.replace('encrypted_', ''),
  maskApiKey: (value: string) => `${value.slice(0, 4)}****`,
}));
mock.module('../../../utils/ai-client', () => ({
  getApiKeyForProvider: mock(() => Promise.resolve(null)),
}));

const { settingsRoutes } = await import('../../../routes/system/settings');

const savedEnv = process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY;
let app: Elysia;

/** Values written to autoRunMaxConcurrency across every update call. */
function persistedConcurrency(): unknown[] {
  return mockPrisma.userSettings.update.mock.calls
    .map((c) => c[0].data)
    .filter((d) => 'autoRunMaxConcurrency' in d)
    .map((d) => d.autoRunMaxConcurrency);
}

async function patch(body: Record<string, unknown>) {
  const res = await app.handle(
    new Request('http://localhost/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  delete process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY;
  mockPrisma.userSettings.findFirst.mockReset().mockResolvedValue({ id: 1 });
  mockPrisma.userSettings.create.mockReset().mockResolvedValue({ id: 1 });
  mockPrisma.userSettings.update.mockReset().mockResolvedValue({ id: 1 });
  app = new Elysia().use(settingsRoutes) as unknown as Elysia;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY;
  else process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY = savedEnv;
});

describe('PATCH /settings — autoRunMaxConcurrency', () => {
  test('9 は 4 に丸めて保存し、応答も 4 にする', async () => {
    const { status, body } = await patch({ autoRunMaxConcurrency: 9 });
    expect(status).toBe(200);
    expect(persistedConcurrency()).toEqual([4]);
    expect(body.autoRunMaxConcurrency).toBe(4);
    expect(body.autoRunMaxConcurrencyEnvOverride).toBeNull();
  });

  test('0 は 1 に丸めて保存する', async () => {
    const { body } = await patch({ autoRunMaxConcurrency: 0 });
    expect(persistedConcurrency()).toEqual([1]);
    expect(body.autoRunMaxConcurrency).toBe(1);
  });

  test('2 はそのまま保存する', async () => {
    const { body } = await patch({ autoRunMaxConcurrency: 2 });
    expect(persistedConcurrency()).toEqual([2]);
    expect(body.autoRunMaxConcurrency).toBe(2);
  });

  test('省略したときは書き込まない', async () => {
    await patch({ developerModeDefault: true });
    expect(persistedConcurrency()).toEqual([]);
  });

  test('env が設定されていれば、応答で上書き中の値を返す', async () => {
    process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY = '3';
    const { body } = await patch({ autoRunMaxConcurrency: 2 });
    expect(body.autoRunMaxConcurrencyEnvOverride).toBe(3);
  });
});

describe('GET /settings — autoRunMaxConcurrency', () => {
  test('列が未反映の行でも 1 を返し、env が無ければ上書きは null', async () => {
    const res = await app.handle(new Request('http://localhost/settings'));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.autoRunMaxConcurrency).toBe(1);
    expect(body.autoRunMaxConcurrencyEnvOverride).toBeNull();
  });

  test('保存済みの値を返し、env があれば上書き値を返す', async () => {
    mockPrisma.userSettings.findFirst.mockResolvedValue({ id: 1, autoRunMaxConcurrency: 3 });
    process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY = '2';
    const res = await app.handle(new Request('http://localhost/settings'));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.autoRunMaxConcurrency).toBe(3);
    expect(body.autoRunMaxConcurrencyEnvOverride).toBe(2);
  });
});
