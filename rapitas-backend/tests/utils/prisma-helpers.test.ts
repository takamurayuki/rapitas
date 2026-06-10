/**
 * PrismaHelpers テスト
 *
 * isPostgresProvider() / caseInsensitive() の 4 ケースをカバー。
 * 各テストで process.env を退避・復元し、ヘルパーがキャッシュしないことを担保する。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { isPostgresProvider, caseInsensitive } from '../../utils/database/prisma-helpers';

let savedProvider: string | undefined;
let savedDbUrl: string | undefined;

beforeEach(() => {
  savedProvider = process.env.RAPITAS_DB_PROVIDER;
  savedDbUrl = process.env.DATABASE_URL;
});

afterEach(() => {
  if (savedProvider === undefined) {
    delete process.env.RAPITAS_DB_PROVIDER;
  } else {
    process.env.RAPITAS_DB_PROVIDER = savedProvider;
  }
  if (savedDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = savedDbUrl;
  }
});

describe('isPostgresProvider', () => {
  test('RAPITAS_DB_PROVIDER=sqlite のとき false を返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    delete process.env.DATABASE_URL;
    expect(isPostgresProvider()).toBe(false);
  });

  test('DATABASE_URL=file:... のとき false を返す', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(isPostgresProvider()).toBe(false);
  });

  test('Postgres URL のとき true を返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/dev';
    expect(isPostgresProvider()).toBe(true);
  });

  test('両方未設定のとき true を返す（Postgres デフォルト）', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
    expect(isPostgresProvider()).toBe(true);
  });
});

describe('caseInsensitive', () => {
  test('Postgres では { mode: "insensitive" } を返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/dev';
    expect(caseInsensitive()).toEqual({ mode: 'insensitive' });
  });

  test('SQLite では {} を返す', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    delete process.env.DATABASE_URL;
    expect(caseInsensitive()).toEqual({});
  });

  test('SQLite スプレッド後に mode キーが含まれない', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    delete process.env.DATABASE_URL;
    const filter = { contains: 'test', ...caseInsensitive() };
    expect('mode' in filter).toBe(false);
    expect(filter).toEqual({ contains: 'test' });
  });

  test('Postgres スプレッド後に mode: insensitive が含まれる', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    process.env.DATABASE_URL = 'postgresql://localhost:5432/dev';
    const filter = { contains: 'test', ...caseInsensitive() };
    expect(filter).toEqual({ contains: 'test', mode: 'insensitive' });
  });
});
