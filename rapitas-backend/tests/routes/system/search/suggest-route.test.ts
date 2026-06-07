/**
 * Search Suggest Route テスト
 *
 * P2021 (テーブル未存在) 発生時のグレースフルデグラデーションと
 * 正常系動作を検証するユニットテスト。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

// NOTE: Extends Error so that `instanceof Prisma.PrismaClientKnownRequestError` passes
// inside the route's catch block when @prisma/client is mocked below.
class MockPrismaClientKnownRequestError extends Error {
  code: string;
  meta?: Record<string, unknown>;

  constructor(message: string, { code, meta }: { code: string; meta?: Record<string, unknown> }) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = code;
    this.meta = meta;
  }
}

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
  },
  comment: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: MockPrismaClientKnownRequestError,
  },
}));
mock.module('../../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { searchSuggestRoute } = await import('../../../../routes/system/search/suggest-route');
const app = new Elysia().use(searchSuggestRoute);

describe('GET /suggest', () => {
  beforeEach(() => {
    mockPrisma.task.findMany.mockReset();
    mockPrisma.comment.findMany.mockReset();
    mockPrisma.task.findMany.mockImplementation(() => Promise.resolve([]));
    mockPrisma.comment.findMany.mockImplementation(() => Promise.resolve([]));
  });

  test('クエリが未指定の場合は DB を叩かずに空配列を返す', async () => {
    const res = await app.handle(new Request('http://localhost/suggest'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, suggestions: [] });
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });

  test('クエリが空文字の場合は DB を叩かずに空配列を返す', async () => {
    const res = await app.handle(new Request('http://localhost/suggest?q='));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, suggestions: [] });
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });

  test('正常系: クエリがある場合は success: true でサジェストを返す', async () => {
    mockPrisma.task.findMany.mockImplementation(() =>
      Promise.resolve([
        { id: 1, title: 'test task', description: null, status: 'todo', updatedAt: new Date() },
      ]),
    );

    const res = await app.handle(new Request('http://localhost/suggest?q=test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.suggestions)).toBe(true);
  });

  test('P2021 エラー時は HTTP 200 + 空サジェストを返す', async () => {
    const p2021Err = new MockPrismaClientKnownRequestError(
      'The table `main.Task` does not exist in the current database.',
      { code: 'P2021', meta: { table: 'main.Task' } },
    );
    mockPrisma.task.findMany.mockImplementation(() => Promise.reject(p2021Err));

    const res = await app.handle(new Request('http://localhost/suggest?q=test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, suggestions: [] });
  });

  test('P2021 以外の Prisma エラー時は HTTP 500 を返す', async () => {
    const otherErr = new MockPrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
    });
    mockPrisma.task.findMany.mockImplementation(() => Promise.reject(otherErr));

    const res = await app.handle(new Request('http://localhost/suggest?q=test'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });

  test('予期しないエラー時は HTTP 500 を返す', async () => {
    mockPrisma.task.findMany.mockImplementation(() =>
      Promise.reject(new Error('DB connection failed')),
    );

    const res = await app.handle(new Request('http://localhost/suggest?q=test'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});
