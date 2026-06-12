/**
 * prisma-sync.test.ts
 *
 * Unit tests for normalizeExitCode() and resolveDbProvider() in prisma-sync.ts.
 * Covers exit-code normalization edge cases (normal exit, error, signal-killed)
 * and environment-variable-based provider resolution.
 */
import { mock, describe, test, expect, beforeEach, afterEach } from 'bun:test';

// Mock server-manager before importing prisma-sync to prevent log file I/O
// and pino stream setup during test execution.
mock.module('./server-manager', () => ({
  ROOT_DIR: '/mock/root',
  log: {
    info: () => {},
    success: () => {},
    warn: () => {},
    error: () => {},
  },
}));

const { normalizeExitCode, resolveDbProvider } = await import('./prisma-sync');

// ---------------------------------------------------------------------------
// normalizeExitCode
// ---------------------------------------------------------------------------

describe('normalizeExitCode', () => {
  test('exit 0 (正常終了) → 0 を返す', () => {
    expect(normalizeExitCode(0, null)).toBe(0);
  });

  test('exit 1 (schema エラー等) → 1 を返す', () => {
    expect(normalizeExitCode(1, null)).toBe(1);
  });

  test('exit 2 (その他の非0コード) → 2 を返す', () => {
    expect(normalizeExitCode(2, null)).toBe(2);
  });

  test('null + signalCode=SIGKILL (プロセス強制終了) → 1 を返す', () => {
    expect(normalizeExitCode(null, 'SIGKILL')).toBe(1);
  });

  test('null + signalCode=SIGTERM (プロセス終了シグナル) → 1 を返す', () => {
    expect(normalizeExitCode(null, 'SIGTERM')).toBe(1);
  });

  test('null + signalCode=null (signal なし・原因不明の終了) → 安全側として 1 を返す', () => {
    expect(normalizeExitCode(null, null)).toBe(1);
  });

  test('null + signalCode 省略 → 1 を返す', () => {
    expect(normalizeExitCode(null)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveDbProvider
// ---------------------------------------------------------------------------

describe('resolveDbProvider', () => {
  const ENV_KEYS = ['RAPITAS_DB_PROVIDER', 'DATABASE_URL'] as const;
  type EnvKey = (typeof ENV_KEYS)[number];
  const saved: Partial<Record<EnvKey, string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key] as string;
      }
    }
  });

  test('RAPITAS_DB_PROVIDER=sqlite → sqlite を返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    expect(resolveDbProvider()).toBe('sqlite');
  });

  test('RAPITAS_DB_PROVIDER=postgresql → postgresql を返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    expect(resolveDbProvider()).toBe('postgresql');
  });

  test('RAPITAS_DB_PROVIDER=postgresql が file: DATABASE_URL より優先される', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(resolveDbProvider()).toBe('postgresql');
  });

  test('RAPITAS_DB_PROVIDER=sqlite が postgresql:// DATABASE_URL より優先される', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/rapitas';
    expect(resolveDbProvider()).toBe('sqlite');
  });

  test('明示設定なし + DATABASE_URL=file:./dev.db → sqlite を返す', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(resolveDbProvider()).toBe('sqlite');
  });

  test('明示設定なし + DATABASE_URL=postgresql://... → postgresql を返す', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    process.env.DATABASE_URL = 'postgresql://localhost:5432/rapitas';
    expect(resolveDbProvider()).toBe('postgresql');
  });

  test('環境変数なし → デフォルト postgresql を返す', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
    expect(resolveDbProvider()).toBe('postgresql');
  });
});
