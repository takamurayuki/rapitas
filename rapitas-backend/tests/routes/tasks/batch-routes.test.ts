/**
 * Batch Routes テスト
 * バッチリクエスト処理のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    count: mock(() => Promise.resolve(0)),
    groupBy: mock(() => Promise.resolve([])),
  },
  category: {
    findMany: mock(() => Promise.resolve([])),
  },
  theme: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module('../../../config', () => ({
  prisma: mockPrisma,
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { batchRoutes } = await import('../../../routes/tasks/batch');

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
    .use(batchRoutes);
}

describe('POST /batch', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('バッチリクエストを処理すること', async () => {
    const categories = [{ id: 1, name: '開発' }];
    mockPrisma.category.findMany.mockResolvedValue(categories);

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/categories' }],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('req1');
    expect(body[0].status).toBe(200);
  });

  test('複数リクエストを並列処理すること', async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);
    mockPrisma.theme.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            { id: 'req1', method: 'GET', url: '/categories' },
            { id: 'req2', method: 'GET', url: '/themes' },
          ],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.length).toBe(2);
    expect(body[0].id).toBe('req1');
    expect(body[1].id).toBe('req2');
  });

  test('不明なリソースでエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/unknown' }],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe(500);
    expect(body[0].error).toBeDefined();
  });

  test('リクエストなしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });

  test('タスクの取得リクエストを処理すること', async () => {
    const tasks = [{ id: 1, title: 'テストタスク' }];
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/tasks' }],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe(200);
  });

  test('空のrequestsで空配列を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [] }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test('themeId/statusフィルタを適用すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/tasks?themeId=3&status=todo' }],
        }),
      }),
    );

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { themeId?: number; status?: string };
    };
    expect(call.where.themeId).toBe(3);
    expect(call.where.status).toBe('todo');
  });

  test('sinceパラメータでincremental取得すること', async () => {
    const tasks = [{ id: 1, title: 'T' }];
    mockPrisma.task.findMany.mockResolvedValue(tasks);
    mockPrisma.task.count.mockResolvedValue(7);

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/tasks?since=2026-01-01T00:00:00.000Z' }],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe(200);
    expect(body[0].body.incremental).toBe(true);
    expect(body[0].body.totalCount).toBe(7);
    expect(body[0].body.activeIds).toEqual([1]);
  });

  test('タスクの関連タスク取得を処理すること', async () => {
    const task = { id: 10, themeId: 2 };
    const related = [{ id: 11, themeId: 2 }];
    mockPrisma.task.findUnique.mockResolvedValue(task);
    mockPrisma.task.findMany.mockResolvedValue(related);

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/tasks/10/related' }],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe(200);
    expect(body[0].body).toEqual(related);
    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { AND: Array<Record<string, unknown>> };
      take: number;
    };
    expect(call.take).toBe(5);
    expect(call.where.AND).toEqual([{ id: { not: 10 } }, { themeId: 2 }]);
  });

  test('存在しないタスクの関連取得で500を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/tasks/999/related' }],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe(500);
    expect(body[0].body).toBeNull();
    expect(body[0].error).toBe('Task not found');
  });

  test('タスクリソースの未対応メソッドで500を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'POST', url: '/tasks' }],
        }),
      }),
    );
    const body = await res.json();

    expect(body[0].status).toBe(500);
    expect(body[0].error).toBe('Unsupported method: POST');
  });

  test('カテゴリリソースの未対応メソッドで500を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'DELETE', url: '/categories' }],
        }),
      }),
    );
    const body = await res.json();

    expect(body[0].status).toBe(500);
    expect(body[0].error).toBe('Unsupported method: DELETE');
  });

  test('テーマ一覧を取得すること', async () => {
    const themes = [{ id: 1, name: 'テーマ' }];
    mockPrisma.theme.findMany.mockResolvedValue(themes);

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/themes' }],
        }),
      }),
    );
    const body = await res.json();

    expect(body[0].status).toBe(200);
    expect(body[0].body).toEqual(themes);
  });

  test('テーマリソースの未対応メソッドで500を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'PUT', url: '/themes' }],
        }),
      }),
    );
    const body = await res.json();

    expect(body[0].status).toBe(500);
    expect(body[0].error).toBe('Unsupported method: PUT');
  });

  test('タスク統計を取得すること', async () => {
    mockPrisma.task.count.mockResolvedValue(5);
    mockPrisma.task.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by[0] === 'status') {
        return Promise.resolve([
          { status: 'todo', _count: 3 },
          { status: 'done', _count: 2 },
        ]);
      }
      return Promise.resolve([
        { themeId: 1, _count: 4 },
        { themeId: null, _count: 1 },
      ]);
    });

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/statistics/tasks' }],
        }),
      }),
    );
    const body = await res.json();

    expect(body[0].status).toBe(200);
    expect(body[0].body.total).toBe(5);
    expect(body[0].body.byStatus).toEqual({ todo: 3, done: 2 });
    expect(body[0].body.byCategory).toEqual({ '1': 4, null: 1 });
  });

  test('未対応の統計リソースで500を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/statistics/users' }],
        }),
      }),
    );
    const body = await res.json();

    expect(body[0].status).toBe(500);
    expect(body[0].error).toBe('Unsupported statistics request');
  });

  test('statusプロパティ付きエラーをそのステータスで返すこと', async () => {
    mockPrisma.task.findUnique.mockRejectedValue({ status: 404, message: 'Not Found' });

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/tasks/1' }],
        }),
      }),
    );
    const body = await res.json();

    expect(body[0].status).toBe(404);
    expect(body[0].error).toBe('Not Found');
  });

  test('messageのないエラーで既定のエラーメッセージを返すこと', async () => {
    mockPrisma.task.findUnique.mockRejectedValue({});

    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/tasks/1' }],
        }),
      }),
    );
    const body = await res.json();

    expect(body[0].status).toBe(500);
    expect(body[0].error).toBe('Internal server error');
  });

  test('未知のリソースURLをエラーメッセージに含めること', async () => {
    const res = await app.handle(
      new Request('http://localhost/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ id: 'req1', method: 'GET', url: '/foobar' }],
        }),
      }),
    );
    const body = await res.json();

    expect(body[0].status).toBe(500);
    expect(body[0].error).toBe('Unknown resource: foobar (URL was: /foobar)');
  });
});
