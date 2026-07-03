/**
 * Batch V2 Routes テスト
 * 最適化バッチAPI (キャッシュ + 並列処理) のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    count: mock(() => Promise.resolve(0)),
    groupBy: mock(() => Promise.resolve([])),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({ id: 1 })),
    delete: mock(() => Promise.resolve({ id: 1 })),
  },
};

const mockCacheService = {
  get: mock(() => Promise.resolve(null)),
  set: mock(() => Promise.resolve()),
  delete: mock(() => Promise.resolve()),
  clear: mock(() => Promise.resolve()),
  has: mock(() => Promise.resolve(false)),
  getOrSet: mock(async (_key: string, factory: () => Promise<unknown>) => factory()),
  setWithTags: mock(() => Promise.resolve()),
  invalidateByTags: mock(() => Promise.resolve()),
  warmup: mock(() => Promise.resolve()),
  getWithStats: mock(() => Promise.resolve(null)),
  getStats: mock(() => ({ hits: 0, misses: 0, sets: 0, deletes: 0, total: 0, hitRate: '0.00%' })),
  resetStats: mock(() => {}),
};

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
  logger: {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    child: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
  },
}));
// NOTE: mock.module is process-global — this mirrors every real export of
// cache-service.ts (CacheService/cacheService/CacheKeys/Cacheable) so a
// different test file importing the same module later in this run doesn't
// break on a missing export.
mock.module('../../../services/core/cache-service', () => ({
  CacheService: class {},
  cacheService: mockCacheService,
  CacheKeys: {
    task: (id: string) => `task:${id}`,
    taskList: (filters: Record<string, unknown>) => `tasks:${JSON.stringify(filters)}`,
    project: (id: string) => `project:${id}`,
    user: (id: string) => `user:${id}`,
    statistics: (type: string) => `stats:${type}`,
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600, DAY: 86400 },
  },
  Cacheable: () => (_target: object, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

const { batchRoutesV2 } = await import('../../../routes/tasks/batch-v2');

function resetAllMocks() {
  for (const method of Object.values(mockPrisma.task)) {
    (method as ReturnType<typeof mock>).mockReset();
  }
  for (const method of Object.values(mockCacheService)) {
    if (typeof method === 'function' && 'mockReset' in method) {
      (method as ReturnType<typeof mock>).mockReset();
    }
  }
  mockCacheService.get.mockResolvedValue(null);
  mockCacheService.set.mockResolvedValue(undefined);
  mockCacheService.delete.mockResolvedValue(undefined);
  mockCacheService.clear.mockResolvedValue(undefined);
  mockCacheService.getStats.mockReturnValue({
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    total: 0,
    hitRate: '0.00%',
  });
}

function createApp() {
  return new Elysia()
    .onError(({ code, set }) => {
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return { error: 'Server error' };
    })
    .use(batchRoutesV2);
}

function batchRequest(requests: unknown[]) {
  return new Request('http://localhost/batch/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
}

describe('POST /batch/v2', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('requestsが空でも0件のメタデータを返すこと', async () => {
    const res = await app.handle(batchRequest([]));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results).toEqual([]);
    expect(body.metadata.totalRequests).toBe(0);
    // NOTE: averageExecutionTime must not silently degrade to null (0/0 = NaN).
    expect(body.metadata.averageExecutionTime).toBe(0);
  });

  test('requestsが無い場合は422を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/batch/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(422);
  });

  test('未対応のmethod値で422を返すこと', async () => {
    const res = await app.handle(batchRequest([{ id: 'r1', method: 'OPTIONS', path: '/tasks' }]));
    expect(res.status).toBe(422);
  });

  test('pathが無い場合は422を返すこと', async () => {
    const res = await app.handle(batchRequest([{ id: 'r1', method: 'GET' }]));
    expect(res.status).toBe(422);
  });

  test('GET /tasksでキャッシュミス時にDBから取得しキャッシュへ保存すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([{ id: 1 }]);

    const res = await app.handle(batchRequest([{ id: 'r1', method: 'GET', path: '/tasks' }]));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results[0].status).toBe(200);
    expect(mockPrisma.task.findMany).toHaveBeenCalledTimes(1);
    const setCall = mockCacheService.set.mock.calls[0]!;
    expect(setCall[2]).toBe(300); // TTL.MEDIUM
  });

  test('GET /tasksでキャッシュヒット時はDBを呼ばないこと', async () => {
    mockCacheService.get.mockResolvedValue({ data: [{ id: 9 }] });

    const res = await app.handle(batchRequest([{ id: 'r1', method: 'GET', path: '/tasks' }]));
    const body = await res.json();

    expect(body.results[0].body.cached).toBe(true);
    expect(body.results[0].cached).toBe(true);
    expect(body.metadata.cachedCount).toBe(1);
    expect(res.headers.get('x-batch-cached-count')).toBe('1');
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });

  test('GET /tasks?since=でincremental結果を返しSHORT TTLで保存すること', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: 1 }]);
    mockPrisma.task.count.mockResolvedValue(3);

    const res = await app.handle(
      batchRequest([{ id: 'r1', method: 'GET', path: '/tasks?since=2026-01-01T00:00:00.000Z' }]),
    );
    const body = await res.json();

    expect(body.results[0].status).toBe(200);
    expect(body.results[0].body.incremental).toBe(true);
    expect(body.results[0].body.totalCount).toBe(3);
    expect(body.results[0].body.activeIds).toEqual([1]);
    const setCall = mockCacheService.set.mock.calls[0]!;
    expect(setCall[2]).toBe(60); // TTL.SHORT
  });

  test('GET /tasks?search=でカーソルページネーション結果を返すこと', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ id: i + 1 }));
    mockPrisma.task.findMany.mockResolvedValue(items);

    const res = await app.handle(
      batchRequest([{ id: 'r1', method: 'GET', path: '/tasks?search=foo' }]),
    );
    const body = await res.json();

    expect(body.results[0].status).toBe(200);
    expect(body.results[0].body.data.length).toBe(20);
    expect(body.results[0].body.hasNextPage).toBe(true);
    expect(body.results[0].body.nextCursor).toBe('20');
  });

  test('GET /tasks/:idで存在しないタスクは200・body nullを返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(batchRequest([{ id: 'r1', method: 'GET', path: '/tasks/999' }]));
    const body = await res.json();

    // Regression check for the null.cached crash fixed in batch-v2.ts.
    expect(body.results[0].status).toBe(200);
    expect(body.results[0].body).toBeNull();
    expect(body.results[0].cached).toBe(false);
    expect(mockCacheService.set).not.toHaveBeenCalled();
  });

  test('GET /tasks/:idで見つかった場合キャッシュへ保存すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 5, title: 'X' });

    const res = await app.handle(batchRequest([{ id: 'r1', method: 'GET', path: '/tasks/5' }]));
    const body = await res.json();

    expect(body.results[0].status).toBe(200);
    expect(body.results[0].body).toEqual({ id: 5, title: 'X' });
    expect(mockCacheService.set).toHaveBeenCalledTimes(1);
    const findCall = mockPrisma.task.findUnique.mock.calls[0]![0] as { where: { id: number } };
    expect(findCall.where.id).toBe(5);
  });

  test('英字IDでも正規表現フォールバックでハンドラを解決すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(batchRequest([{ id: 'r1', method: 'GET', path: '/tasks/abc' }]));
    const body = await res.json();

    expect(body.results[0].status).toBe(200);
    const call = mockPrisma.task.findUnique.mock.calls[0]![0] as { where: { id: number } };
    expect(Number.isNaN(call.where.id)).toBe(true);
  });

  test('GET /statistics/tasksでLONG TTLで保存すること', async () => {
    mockPrisma.task.count.mockResolvedValue(10);
    mockPrisma.task.groupBy.mockResolvedValue([]);
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(
      batchRequest([{ id: 'r1', method: 'GET', path: '/statistics/tasks' }]),
    );
    const body = await res.json();

    expect(body.results[0].status).toBe(200);
    expect(body.results[0].body.total).toBe(10);
    const setCall = mockCacheService.set.mock.calls[0]!;
    expect(setCall[2]).toBe(3600); // TTL.LONG
  });

  test('POST /tasksでタスクを作成しキャッシュを無効化すること', async () => {
    mockPrisma.task.create.mockResolvedValue({ id: 7, title: 'New' });

    const res = await app.handle(
      batchRequest([{ id: 'r1', method: 'POST', path: '/tasks', params: { title: 'New' } }]),
    );
    const body = await res.json();

    expect(body.results[0].status).toBe(200);
    expect(body.results[0].body).toEqual({ id: 7, title: 'New' });
    expect(mockCacheService.clear).toHaveBeenCalledWith('tasks:');
    expect(mockCacheService.clear).toHaveBeenCalledWith('stats:');
  });

  test('PATCH /tasks/:idでタスクを更新しキャッシュを削除すること', async () => {
    mockPrisma.task.update.mockResolvedValue({ id: 5, title: 'Updated' });

    const res = await app.handle(
      batchRequest([{ id: 'r1', method: 'PATCH', path: '/tasks/5', params: { title: 'Updated' } }]),
    );
    const body = await res.json();

    expect(body.results[0].status).toBe(200);
    const updateCall = mockPrisma.task.update.mock.calls[0]![0] as { where: { id: number } };
    expect(updateCall.where.id).toBe(5);
    expect(mockCacheService.delete).toHaveBeenCalledWith('task:5');
  });

  test('DELETE /tasks/:idでタスクを削除すること', async () => {
    const res = await app.handle(batchRequest([{ id: 'r1', method: 'DELETE', path: '/tasks/5' }]));
    const body = await res.json();

    expect(body.results[0].status).toBe(200);
    expect(body.results[0].body).toEqual({ success: true });
    const deleteCall = mockPrisma.task.delete.mock.calls[0]![0] as { where: { id: number } };
    expect(deleteCall.where.id).toBe(5);
  });

  test('ハンドラが存在しない場合500を返すこと', async () => {
    const res = await app.handle(batchRequest([{ id: 'r1', method: 'PUT', path: '/tasks' }]));
    const body = await res.json();

    expect(body.results[0].status).toBe(500);
    expect(body.results[0].error).toBe('No handler found for PUT /tasks');
  });

  test('statusプロパティ付きエラーをそのステータスで返すこと', async () => {
    mockPrisma.task.findUnique.mockRejectedValue({ status: 404, message: 'Not Found' });

    const res = await app.handle(batchRequest([{ id: 'r1', method: 'GET', path: '/tasks/5' }]));
    const body = await res.json();

    expect(body.results[0].status).toBe(404);
    expect(body.results[0].error).toBe('Not Found');
    expect(body.metadata.errorCount).toBe(1);
  });

  test('messageのないエラーで既定のメッセージを返すこと', async () => {
    mockPrisma.task.findUnique.mockRejectedValue({});

    const res = await app.handle(batchRequest([{ id: 'r1', method: 'GET', path: '/tasks/5' }]));
    const body = await res.json();

    expect(body.results[0].status).toBe(500);
    expect(body.results[0].error).toBe('Internal server error');
  });

  test('複数リクエストを並行処理数の上限を超えても順序通り処理すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    const requests = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      method: 'GET' as const,
      path: '/tasks',
    }));

    const res = await app.handle(batchRequest(requests));
    const body = await res.json();

    expect(body.results.length).toBe(12);
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(requests.map((r) => r.id));
    expect(body.metadata.totalRequests).toBe(12);
    expect(body.metadata.successCount).toBe(12);
  });

  test('x-batch-total-timeヘッダーを付与すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(batchRequest([{ id: 'r1', method: 'GET', path: '/tasks' }]));

    expect(res.headers.get('x-batch-total-time')).toMatch(/^\d+(\.\d+)?ms$/);
  });
});

describe('GET /batch/v2/stats', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('キャッシュ統計と登録済みハンドラ一覧を返すこと', async () => {
    mockCacheService.getStats.mockReturnValue({
      hits: 5,
      misses: 2,
      sets: 3,
      deletes: 0,
      total: 7,
      hitRate: '71.43%',
    });

    const res = await app.handle(new Request('http://localhost/batch/v2/stats'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cache.hitRate).toBe('71.43%');
    expect(body.handlers).toContain('GET:/tasks');
    expect(body.handlers).toContain('DELETE:/tasks/:id');
  });
});
