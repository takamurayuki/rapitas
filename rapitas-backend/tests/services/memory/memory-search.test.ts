/**
 * Memory Search テスト
 *
 * listKnowledgeEntries / searchCrossProjectKnowledge が
 * PostgreSQL 環境では `mode:'insensitive'` を付与し、
 * SQLite 環境では `mode` なしのクエリを生成することを検証する。
 */
import { describe, test, expect, mock, afterEach, beforeEach } from 'bun:test';

// --- Prisma mock ---
const findManyMock = mock(() => Promise.resolve([]));
const countMock = mock(() => Promise.resolve(0));

const mockPrisma = {
  knowledgeEntry: {
    findMany: findManyMock,
    count: countMock,
  },
  theme: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
}));

const { listKnowledgeEntries } = await import('../../../services/memory/index');
const { searchCrossProjectKnowledge } =
  await import('../../../services/memory/task-knowledge-extractor');

// ---- 環境変数ヘルパー ----

function usePostgresEnv() {
  delete process.env.RAPITAS_DB_PROVIDER;
  delete process.env.DATABASE_URL;
}

function useSQLiteProviderEnv() {
  process.env.RAPITAS_DB_PROVIDER = 'sqlite';
  delete process.env.DATABASE_URL;
}

function useSQLiteUrlEnv() {
  delete process.env.RAPITAS_DB_PROVIDER;
  process.env.DATABASE_URL = 'file:./test.db';
}

// ---- listKnowledgeEntries ----

describe('listKnowledgeEntries — isPostgres 分岐', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    countMock.mockReset();
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
  });

  afterEach(() => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
  });

  test('PostgreSQL 環境: mode:"insensitive" が where.OR に付与される', async () => {
    usePostgresEnv();

    await listKnowledgeEntries({ search: 'hello' });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const call = findManyMock.mock.calls[0][0] as { where: Record<string, unknown> };
    const or = call.where.OR as Array<{ title?: unknown; content?: unknown }>;
    expect(Array.isArray(or)).toBe(true);
    expect((or[0].title as Record<string, unknown>).mode).toBe('insensitive');
    expect((or[1].content as Record<string, unknown>).mode).toBe('insensitive');
  });

  test('SQLite 環境 (RAPITAS_DB_PROVIDER=sqlite): mode キーが存在しない', async () => {
    useSQLiteProviderEnv();

    await listKnowledgeEntries({ search: 'hello' });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const call = findManyMock.mock.calls[0][0] as { where: Record<string, unknown> };
    const or = call.where.OR as Array<{ title?: unknown; content?: unknown }>;
    expect(Array.isArray(or)).toBe(true);
    expect('mode' in (or[0].title as Record<string, unknown>)).toBe(false);
    expect('mode' in (or[1].content as Record<string, unknown>)).toBe(false);
  });

  test('SQLite 環境 (DATABASE_URL=file:...): mode キーが存在しない', async () => {
    useSQLiteUrlEnv();

    await listKnowledgeEntries({ search: 'hello' });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const call = findManyMock.mock.calls[0][0] as { where: Record<string, unknown> };
    const or = call.where.OR as Array<{ title?: unknown; content?: unknown }>;
    expect('mode' in (or[0].title as Record<string, unknown>)).toBe(false);
  });

  test('search 未指定: where.OR が付与されない', async () => {
    usePostgresEnv();

    await listKnowledgeEntries({});

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const call = findManyMock.mock.calls[0][0] as { where: Record<string, unknown> };
    expect('OR' in call.where).toBe(false);
  });
});

// ---- searchCrossProjectKnowledge ----

describe('searchCrossProjectKnowledge — isPostgres 分岐', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([]);
    (mockPrisma.theme.findMany as ReturnType<typeof mock>).mockReset();
    (mockPrisma.theme.findMany as ReturnType<typeof mock>).mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
  });

  test('PostgreSQL 環境: mode:"insensitive" が OR 条件に付与される', async () => {
    usePostgresEnv();

    await searchCrossProjectKnowledge('test query');

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const call = findManyMock.mock.calls[0][0] as {
      where: { OR: Array<{ OR: Array<{ title?: unknown }> }> };
    };
    const innerOr = call.where.OR[0].OR;
    expect((innerOr[0].title as Record<string, unknown>).mode).toBe('insensitive');
  });

  test('SQLite 環境 (RAPITAS_DB_PROVIDER=sqlite): mode キーが存在しない', async () => {
    useSQLiteProviderEnv();

    await searchCrossProjectKnowledge('test query');

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const call = findManyMock.mock.calls[0][0] as {
      where: { OR: Array<{ OR: Array<{ title?: unknown }> }> };
    };
    const innerOr = call.where.OR[0].OR;
    expect('mode' in (innerOr[0].title as Record<string, unknown>)).toBe(false);
  });

  test('SQLite 環境 (DATABASE_URL=file:...): mode キーが存在しない', async () => {
    useSQLiteUrlEnv();

    await searchCrossProjectKnowledge('test query');

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const call = findManyMock.mock.calls[0][0] as {
      where: { OR: Array<{ OR: Array<{ title?: unknown }> }> };
    };
    const innerOr = call.where.OR[0].OR;
    expect('mode' in (innerOr[0].title as Record<string, unknown>)).toBe(false);
  });

  test('空クエリ: findMany を呼ばず空結果を返す', async () => {
    usePostgresEnv();

    const result = await searchCrossProjectKnowledge('');

    expect(findManyMock).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(0);
    expect(result.totalAcrossProjects).toBe(0);
  });
});
