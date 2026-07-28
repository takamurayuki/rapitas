/**
 * tasks.ts ギャップテスト
 *
 * task-routes.test.ts でカバーされていないエンドポイント/分岐を対象とする:
 * GET /tasks/test, GET /tasks/:id/terminal-context, GET /tasks/statistics,
 * GET /tasks の milestoneId/priority/dueDateOn フィルタとページネーション。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { resolve } from 'path';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    count: mock(() => Promise.resolve(0)),
    groupBy: mock(() => Promise.resolve([])),
  },
  theme: {
    findMany: mock(() => Promise.resolve([])),
  },
  agentSession: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  workflowTransition: {
    findMany: mock(() => Promise.resolve([])),
  },
  $transaction: mock((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
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
    if (typeof model === 'object' && model !== null) {
      for (const method of Object.values(model)) {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as ReturnType<typeof mock>).mockReset();
        }
      }
    }
  }
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockPrisma),
  );
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

describe('GET /tasks/test', () => {
  test('動作確認メッセージを返すこと', async () => {
    const app = createApp();
    const res = await app.handle(new Request('http://localhost/tasks/test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: 'test endpoint working' });
  });
});

describe('GET /tasks/:id/terminal-context', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/abc/terminal-context'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid task id');
  });

  test('存在しないタスクで404を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/tasks/1/terminal-context'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Task not found');
  });

  test('アクティブなworktreeセッションを最優先で使うこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      title: 'Task 1',
      workingDirectory: '/task/dir',
      theme: { workingDirectory: '/theme/dir' },
    });
    mockPrisma.agentSession.findFirst.mockResolvedValue({ worktreePath: '/worktree/path' });

    const res = await app.handle(new Request('http://localhost/tasks/1/terminal-context'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cwd).toBe('/worktree/path');
    expect(body.title).toBe('Task 1');
  });

  test('セッションが無い場合はtask.workingDirectoryを使うこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      title: 'Task 1',
      workingDirectory: '/task/dir',
      theme: { workingDirectory: '/theme/dir' },
    });
    mockPrisma.agentSession.findFirst.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/tasks/1/terminal-context'));
    const body = await res.json();

    expect(body.cwd).toBe('/task/dir');
  });

  test('task.workingDirectoryも無い場合はtheme.workingDirectoryを使うこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      title: 'Task 1',
      workingDirectory: null,
      theme: { workingDirectory: '/theme/dir' },
    });
    mockPrisma.agentSession.findFirst.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/tasks/1/terminal-context'));
    const body = await res.json();

    expect(body.cwd).toBe('/theme/dir');
  });

  test('何も無い場合はプロジェクトルートにフォールバックすること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      title: 'Task 1',
      workingDirectory: null,
      theme: null,
    });
    mockPrisma.agentSession.findFirst.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/tasks/1/terminal-context'));
    const body = await res.json();

    // getProjectRoot() resolves one directory above the backend cwd.
    expect(body.cwd).toBe(resolve(process.cwd(), '..'));
  });
});

describe('GET /tasks/statistics', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ステータス別・カテゴリ別の集計を返すこと', async () => {
    mockPrisma.task.count.mockResolvedValue(10);
    mockPrisma.task.groupBy
      // Call order matches the route: status/priority groupBy run inside
      // QueryOptimizers.getTaskStatistics, then the themeId groupBy this
      // route added (replacing an unbounded findMany over every task).
      .mockResolvedValueOnce([
        { status: 'todo', _count: { status: 4 } },
        { status: 'done', _count: { status: 6 } },
      ])
      .mockResolvedValueOnce([{ priority: 'medium', _count: { priority: 10 } }])
      .mockResolvedValueOnce([
        { themeId: 1, _count: { _all: 2 } },
        { themeId: null, _count: { _all: 1 } },
      ]);
    mockPrisma.theme.findMany.mockResolvedValue([{ id: 1, categoryId: 1 }]);

    const res = await app.handle(new Request('http://localhost/tasks/statistics'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(10);
    expect(body.byStatus).toEqual({ todo: 4, done: 6 });
    expect(body.byCategory).toEqual({ 1: 2, 0: 1 });
  });

  test('内部エラー時に500とエラーメッセージを返すこと', async () => {
    mockPrisma.task.count.mockRejectedValue(new Error('DB unavailable'));

    const res = await app.handle(new Request('http://localhost/tasks/statistics'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('DB unavailable');
  });
});

describe('GET /tasks 追加フィルタとページネーション', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('milestoneIdフィルタを適用すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/tasks?milestoneId=7'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { milestoneId?: number };
    };
    expect(call.where.milestoneId).toBe(7);
  });

  test('priorityフィルタを適用すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/tasks?priority=high'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as { where: { priority?: string } };
    expect(call.where.priority).toBe('high');
  });

  test('dueDateOnフィルタでその日のローカル範囲を指定すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/tasks?dueDateOn=2026-05-01'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { dueDate?: { gte: Date; lte: Date } };
    };
    expect(call.where.dueDate?.gte.toISOString()).toContain('2026-05-01');
    expect(call.where.dueDate?.lte.toISOString()).toContain('2026-05-01');
  });

  test('pageとlimit指定でページネーション結果を返すこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([{ id: 1 }]);
    mockPrisma.task.count.mockResolvedValue(42);

    const res = await app.handle(new Request('http://localhost/tasks?page=2&limit=10'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(10);
    expect(body.totalCount).toBe(42);
    expect(body.totalPages).toBe(5);
    const call = mockPrisma.task.findMany.mock.calls[0]![0] as { take?: number; skip?: number };
    expect(call.take).toBe(10);
    expect(call.skip).toBe(10);
  });

  test('limitは500件を上限にクランプされること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(0);

    await app.handle(new Request('http://localhost/tasks?page=1&limit=9999'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as { take?: number };
    expect(call.take).toBe(500);
  });

  test('pageのみでlimitが無い場合はページネーションされず配列を返すこと', async () => {
    const tasks = [{ id: 1 }, { id: 2 }];
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    const res = await app.handle(new Request('http://localhost/tasks?page=2'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(tasks);
    const call = mockPrisma.task.findMany.mock.calls[0]![0] as { take?: number; skip?: number };
    expect(call.take).toBeUndefined();
    expect(call.skip).toBeUndefined();
  });
});
