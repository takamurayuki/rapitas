/**
 * tasks.ts のサブタスク管理・クリーンアップ系エンドポイントのテスト
 *
 * task-routes.test.ts に無い以下のエンドポイントを対象とする:
 * POST /:id/cleanup-duplicates, POST /cleanup-completed,
 * POST /cleanup-all-duplicates, DELETE /:id/subtasks,
 * POST /:id/subtasks/delete-selected.
 *
 * cleanupDuplicateSubtasks / cleanupAllDuplicateSubtasks / cleanupCompletedTasks
 * は実装をそのまま使う（このファイル以外にも各ロジック専用のユニットテストが
 * あるため、task-service や completed-task-cleanup 自体はモックしない）。
 * cleanup-completed の削除本体（extractKnowledgeFromTask / worktree除去）を
 * 経由しないよう、削除候補が0件のケースのみで実削除パスを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([] as Array<Record<string, unknown>>)),
    findUnique: mock(() => Promise.resolve<Record<string, unknown> | null>(null)),
    delete: mock(() => Promise.resolve({})),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
    count: mock(() => Promise.resolve(0)),
  },
  knowledgeEntry: {
    count: mock(() => Promise.resolve(0)),
  },
};

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
  logger: {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    child: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
  },
}));

const { tasksRoutes } = await import('../../../routes/tasks/tasks');
const { AppError } = await import('../../../middleware/error-handler');

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const method of Object.values(model)) {
      if (typeof method === 'function' && 'mockReset' in method) {
        (method as ReturnType<typeof mock>).mockReset();
      }
    }
  }
}

function createApp() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message, code: error.code };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Server error' };
    })
    .use(tasksRoutes);
}

describe('POST /tasks/:id/cleanup-duplicates', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/abc/cleanup-duplicates', { method: 'POST' }),
    );
    expect(res.status).toBe(400);
  });

  test('親タスクが存在しない場合は400を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/tasks/1/cleanup-duplicates', { method: 'POST' }),
    );
    expect(res.status).toBe(400);
  });

  test('重複タイトルのサブタスクを削除すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 1 });
    mockPrisma.task.findMany.mockResolvedValue([
      { id: 10, title: 'Same', createdAt: new Date(1) },
      { id: 11, title: 'same', createdAt: new Date(2) },
      { id: 12, title: 'Unique', createdAt: new Date(3) },
    ]);

    const res = await app.handle(
      new Request('http://localhost/tasks/1/cleanup-duplicates', { method: 'POST' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deletedCount).toBe(1);
    expect(body.deletedIds).toEqual([11]);
    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: 11 } });
  });

  test('重複が無い場合はメッセージのみ返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 1 });
    mockPrisma.task.findMany.mockResolvedValue([{ id: 10, title: 'Solo', createdAt: new Date() }]);

    const res = await app.handle(
      new Request('http://localhost/tasks/1/cleanup-duplicates', { method: 'POST' }),
    );
    const body = await res.json();

    expect(body.deletedCount).toBe(0);
    expect(body.message).toBe('重複サブタスクはありませんでした');
  });
});

describe('POST /tasks/cleanup-completed', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('dryRunでは削除せず対象件数のみ報告すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockPrisma.task.count.mockResolvedValue(0); // no open subtasks
    mockPrisma.knowledgeEntry.count.mockResolvedValue(0);

    const res = await app.handle(
      new Request('http://localhost/tasks/cleanup-completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepRecent: 0, dryRun: true }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.candidateCount).toBe(2);
    expect(body.message).toContain('dryRun');
    expect(mockPrisma.task.delete).not.toHaveBeenCalled();
  });

  test('候補0件の実行では全テーマ・0件削除のメッセージを返すこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request('http://localhost/tasks/cleanup-completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deletedCount).toBe(0);
    expect(body.themeId).toBeNull();
    expect(body.message).toContain('全テーマ');
  });

  test('themeId指定でスコープされたクエリとメッセージになること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request('http://localhost/tasks/cleanup-completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeId: 3 }),
      }),
    );
    const body = await res.json();

    expect(body.themeId).toBe(3);
    expect(body.message).toContain('テーマ#3');
    const call = mockPrisma.task.findMany.mock.calls[0]![0] as { where: { themeId?: number } };
    expect(call.where.themeId).toBe(3);
  });
});

describe('POST /tasks/cleanup-all-duplicates', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全親タスクを横断して重複サブタスクを削除すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { id: 20, parentId: 1, title: 'Dup', createdAt: new Date(1) },
      { id: 21, parentId: 1, title: 'dup', createdAt: new Date(2) },
      { id: 22, parentId: 2, title: 'Solo', createdAt: new Date(3) },
    ]);

    const res = await app.handle(
      new Request('http://localhost/tasks/cleanup-all-duplicates', { method: 'POST' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deletedCount).toBe(1);
    expect(body.deletedIds).toEqual([21]);
    expect(body.affectedParentIds).toEqual([1]);
  });

  test('重複が無い場合は0件で成功を返すこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request('http://localhost/tasks/cleanup-all-duplicates', { method: 'POST' }),
    );
    const body = await res.json();

    expect(body.deletedCount).toBe(0);
    expect(body.message).toBe('重複サブタスクはありませんでした');
  });
});

describe('DELETE /tasks/:id/subtasks', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/abc/subtasks', { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
  });

  test('親タスクが存在しない場合は400を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/tasks/1/subtasks', { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
  });

  test('全サブタスクを削除して件数を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 1 });
    mockPrisma.task.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);

    const res = await app.handle(
      new Request('http://localhost/tasks/1/subtasks', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deletedCount).toBe(2);
    expect(mockPrisma.task.deleteMany).toHaveBeenCalledWith({ where: { parentId: 1 } });
  });

  test('サブタスクが無い場合はメッセージのみ返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 1 });
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request('http://localhost/tasks/1/subtasks', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(body.deletedCount).toBe(0);
    expect(body.message).toBe('削除するサブタスクがありませんでした');
  });
});

describe('POST /tasks/:id/subtasks/delete-selected', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/abc/subtasks/delete-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtaskIds: [1] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('subtaskIdsが空の場合は400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/1/subtasks/delete-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtaskIds: [] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('親タスクが存在しない場合は400を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/tasks/1/subtasks/delete-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtaskIds: [10] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('親に属さない無効なIDを除外して削除すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 1 });
    mockPrisma.task.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
    mockPrisma.task.deleteMany.mockResolvedValue({ count: 2 });

    const res = await app.handle(
      new Request('http://localhost/tasks/1/subtasks/delete-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtaskIds: [10, 11, 999] }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deletedCount).toBe(2);
    expect(body.deletedIds).toEqual([10, 11]);
    expect(body.invalidIds).toEqual([999]);
    expect(mockPrisma.task.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [10, 11] }, parentId: 1 },
    });
  });

  test('全て有効なIDのみの場合はinvalidIdsが空になること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 1 });
    mockPrisma.task.findMany.mockResolvedValue([{ id: 10 }]);
    mockPrisma.task.deleteMany.mockResolvedValue({ count: 1 });

    const res = await app.handle(
      new Request('http://localhost/tasks/1/subtasks/delete-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtaskIds: [10] }),
      }),
    );
    const body = await res.json();

    expect(body.invalidIds).toEqual([]);
    expect(body.message).toBe('1件のサブタスクを削除しました');
  });
});
