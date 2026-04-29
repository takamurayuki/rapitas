/**
 * Setup Status テスト
 *
 * Verifies the route returns provider-aware diagnostics. Uses mocked Prisma +
 * model-discovery so the test never touches a real DB or spawns CLI probes.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockQueryRawUnsafe = mock(() => Promise.resolve([{ ok: 1 }] as unknown[]));
const mockDiscoverModels = mock(() =>
  Promise.resolve({
    fetchedAt: new Date().toISOString(),
    providers: [{ provider: 'claude', available: true, reason: undefined, models: [{ id: 'a' }] }],
  } as unknown),
);
const mockGetLocalLLMStatus = mock(() => Promise.resolve({ available: false }));

mock.module('../../../config/database', () => ({
  prisma: { $queryRawUnsafe: mockQueryRawUnsafe },
}));
mock.module('../../../services/ai/model-discovery', () => ({
  discoverModels: mockDiscoverModels,
}));
mock.module('../../../services/local-llm', () => ({
  getLocalLLMStatus: mockGetLocalLLMStatus,
}));

import { Elysia } from 'elysia';
import { setupRoutes } from '../../../routes/system/setup';

let originalUrl: string | undefined;
let originalProvider: string | undefined;

beforeEach(() => {
  originalUrl = process.env.DATABASE_URL;
  originalProvider = process.env.RAPITAS_DB_PROVIDER;
  mockQueryRawUnsafe.mockReset();
  mockQueryRawUnsafe.mockResolvedValue([{ ok: 1 }]);
});

afterEach(() => {
  if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl;
  else delete process.env.DATABASE_URL;
  if (originalProvider !== undefined) process.env.RAPITAS_DB_PROVIDER = originalProvider;
  else delete process.env.RAPITAS_DB_PROVIDER;
});

async function callStatus() {
  const app = new Elysia().use(setupRoutes);
  const res = await app.handle(new Request('http://localhost/system/setup/status'));
  return (await res.json()) as {
    database: { provider: string; connected: boolean; filePath?: string };
    providers: Array<{ provider: string; available: boolean }>;
    setupComplete: boolean;
  };
}

describe('GET /system/setup/status', () => {
  it('PostgreSQL接続成功時は connected=true を返す', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    delete process.env.RAPITAS_DB_PROVIDER;
    const r = await callStatus();
    expect(r.database.provider).toBe('postgresql');
    expect(r.database.connected).toBe(true);
  });

  it('SQLite かつファイル不存在の場合は connected=false', async () => {
    const fakePath = path.join(os.tmpdir(), `rapitas-setup-test-${Date.now()}.db`);
    if (fs.existsSync(fakePath)) fs.rmSync(fakePath);
    process.env.DATABASE_URL = `file:${fakePath}`;
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    const r = await callStatus();
    expect(r.database.provider).toBe('sqlite');
    expect(r.database.connected).toBe(false);
    expect(r.database.filePath).toBe(fakePath);
  });

  it('SQLite かつファイル存在 + クエリ成功で connected=true', async () => {
    const realPath = path.join(os.tmpdir(), `rapitas-setup-${Date.now()}.db`);
    fs.writeFileSync(realPath, 'fake');
    process.env.DATABASE_URL = `file:${realPath}`;
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    try {
      const r = await callStatus();
      expect(r.database.provider).toBe('sqlite');
      expect(r.database.connected).toBe(true);
    } finally {
      fs.rmSync(realPath, { force: true });
    }
  });

  it('プロバイダー1つ以上利用可能 + DB接続OKで setupComplete=true', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    const r = await callStatus();
    expect(r.providers.find((p) => p.provider === 'claude')?.available).toBe(true);
    expect(r.setupComplete).toBe(true);
  });
});
