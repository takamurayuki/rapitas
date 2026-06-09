/**
 * Database Provider Utilities Test
 *
 * Verifies that isPostgres() and insensitiveMode() correctly detect the
 * active database provider from environment variables.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { isPostgres, insensitiveMode } from '../../../utils/database/provider';

describe('isPostgres', () => {
  let savedProvider: string | undefined;
  let savedDatabaseUrl: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    savedDatabaseUrl = process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
    if (savedDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedDatabaseUrl;
    }
  });

  test('RAPITAS_DB_PROVIDER=sqlite のとき false を返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    delete process.env.DATABASE_URL;
    expect(isPostgres()).toBe(false);
  });

  test('DATABASE_URL が file: 始まりのとき false を返す', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(isPostgres()).toBe(false);
  });

  test('RAPITAS_DB_PROVIDER=postgresql のとき true を返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    expect(isPostgres()).toBe(true);
  });

  test('両 env 未設定のとき true を返す（PostgreSQL がデフォルト）', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
    expect(isPostgres()).toBe(true);
  });

  test('RAPITAS_DB_PROVIDER=sqlite かつ DATABASE_URL が postgres でも false を返す', () => {
    // RAPITAS_DB_PROVIDER が優先される
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    expect(isPostgres()).toBe(false);
  });
});

describe('insensitiveMode', () => {
  let savedProvider: string | undefined;
  let savedDatabaseUrl: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    savedDatabaseUrl = process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
    if (savedDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedDatabaseUrl;
    }
  });

  test('PostgreSQL 環境で { mode: "insensitive" } を返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    expect(insensitiveMode()).toEqual({ mode: 'insensitive' });
  });

  test('SQLite 環境で空オブジェクトを返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    delete process.env.DATABASE_URL;
    expect(insensitiveMode()).toEqual({});
  });

  test('DATABASE_URL=file: 環境で空オブジェクトを返す', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    process.env.DATABASE_URL = 'file:./local.db';
    expect(insensitiveMode()).toEqual({});
  });

  test('スプレッド後の Prisma フィルタ形式が正しいこと（PostgreSQL）', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    delete process.env.DATABASE_URL;
    const filter = { contains: 'test', ...insensitiveMode() };
    expect(filter).toEqual({ contains: 'test', mode: 'insensitive' });
  });

  test('スプレッド後の Prisma フィルタ形式が正しいこと（SQLite）', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    delete process.env.DATABASE_URL;
    const filter = { contains: 'test', ...insensitiveMode() };
    expect(filter).toEqual({ contains: 'test' });
  });
});
