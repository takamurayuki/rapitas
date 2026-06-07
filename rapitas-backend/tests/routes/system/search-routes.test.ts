/**
 * Search Routes テスト
 * 横断検索APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
  },
  comment: {
    findMany: mock(() => Promise.resolve([])),
  },
  resource: {
    findMany: mock(() => Promise.resolve([])),
  },
  pomodoroSession: {
    findMany: mock(() => Promise.resolve([])),
  },
  timeEntry: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { searchRoutes } = await import('../../../routes/system/search');

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
  mockPrisma.task.findMany.mockResolvedValue([]);
  mockPrisma.comment.findMany.mockResolvedValue([]);
  mockPrisma.resource.findMany.mockResolvedValue([]);
  mockPrisma.pomodoroSession.findMany.mockResolvedValue([]);
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
}

function createApp() {
  return new Elysia().use(searchRoutes);
}

describe('GET /search/', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('検索結果を返すこと', async () => {
    const tasks = [
      {
        id: 1,
        title: 'Test Task',
        description: 'A test description',
        status: 'todo',
        priority: 'medium',
        dueDate: null,
        createdAt: new Date('2026-03-01'),
        updatedAt: new Date('2026-03-01'),
        theme: null,
        taskLabels: [],
      },
    ];
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    const res = await app.handle(new Request('http://localhost/search/?q=Test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.results).toBeDefined();
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.query).toBe('Test');
  });

  test('クエリなしで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/search/'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  test('空のクエリで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/search/?q='));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  test('長すぎるクエリで400を返すこと', async () => {
    const longQuery = 'a'.repeat(501);
    const res = await app.handle(new Request(`http://localhost/search/?q=${longQuery}`));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  test('typeパラメータでフィルタできること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/search/?q=test&type=task'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Only searching tasks, so comment and resource should not be called
    expect(mockPrisma.task.findMany).toHaveBeenCalled();
  });

  test('limitとoffsetが機能すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/search/?q=test&limit=5&offset=10'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(10);
  });

  test('コメント検索結果を含むこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.comment.findMany.mockResolvedValue([
      {
        id: 1,
        content: 'This is a test comment',
        taskId: 1,
        task: { id: 1, title: 'Related Task' },
        createdAt: new Date('2026-03-01'),
        updatedAt: new Date('2026-03-01'),
      },
    ]);
    mockPrisma.resource.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/search/?q=test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.results.some((r: { type: string }) => r.type === 'comment')).toBe(true);
  });

  test('DBエラー時に500を返すこと', async () => {
    mockPrisma.task.findMany.mockRejectedValue(new Error('DB error'));

    const res = await app.handle(new Request('http://localhost/search/?q=test'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });

  test('PomodoroSession テーブル不在 (P2021) の場合、200 で他エンティティ結果を返すこと', async () => {
    const p2021Error = Object.assign(
      new Error('The table `main.PomodoroSession` does not exist in the current database.'),
      { code: 'P2021' },
    );
    mockPrisma.pomodoroSession.findMany.mockRejectedValue(p2021Error);

    const res = await app.handle(new Request('http://localhost/search/?q=test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test('TimeEntry テーブル不在 (P2021) の場合、200 で他エンティティ結果を返すこと', async () => {
    const p2021Error = Object.assign(
      new Error('The table `main.TimeEntry` does not exist in the current database.'),
      { code: 'P2021' },
    );
    mockPrisma.timeEntry.findMany.mockRejectedValue(p2021Error);

    const res = await app.handle(new Request('http://localhost/search/?q=test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe('GET /search/suggest', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('サジェストを返すこと', async () => {
    const tasks = [
      { id: 1, title: 'Test Task', status: 'todo' },
      { id: 2, title: 'Testing', status: 'in_progress' },
    ];
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    const res = await app.handle(new Request('http://localhost/search/suggest?q=Test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.suggestions).toHaveLength(2);
    expect(body.suggestions[0].type).toBe('task');
  });

  test('空クエリで空のサジェストを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/search/suggest?q='));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.suggestions).toEqual([]);
  });

  test('クエリなしで空のサジェストを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/search/suggest'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.suggestions).toEqual([]);
  });

  test('DBエラー時に500を返すこと', async () => {
    mockPrisma.task.findMany.mockRejectedValue(new Error('DB error'));

    const res = await app.handle(new Request('http://localhost/search/suggest?q=test'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});

/**
 * 検索の大文字小文字非区別（case-insensitive）検証。
 *
 * 設計: `mode: 'insensitive'` は Postgres 限定。SQLite (desktop) クライアントは
 * これを実行時に拒否し PrismaClientValidationError を投げる。よって両ルートは
 * アクティブな DB プロバイダを検出し、Postgres のときだけ `mode` を付与する
 * （SQLite は LIKE が既定で ASCII 大文字小文字非区別なので mode 不要）。
 *
 * ここでは prisma をモックし、findMany へ渡される where 句に `mode:insensitive`
 * がプロバイダ条件どおり付与/省略されることを検証する（= 大文字小文字非区別の
 * 中核ロジックと、SQLite での実行時クラッシュ回避を保証）。実データのマッチング
 * は DB エンジンの責務（PG: mode、SQLite: 既定 LIKE）。
 */
describe('検索の大文字小文字非区別（mode:insensitive のプロバイダ条件付与）', () => {
  let app: ReturnType<typeof createApp>;
  const ORIG_URL = process.env.DATABASE_URL;
  const ORIG_PROVIDER = process.env.RAPITAS_DB_PROVIDER;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  afterEach(() => {
    // Restore env so provider detection doesn't leak across test files.
    if (ORIG_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIG_URL;
    if (ORIG_PROVIDER === undefined) delete process.env.RAPITAS_DB_PROVIDER;
    else process.env.RAPITAS_DB_PROVIDER = ORIG_PROVIDER;
  });

  const setPostgres = () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/rapitas';
  };
  const setSqlite = () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    process.env.DATABASE_URL = 'file:./dev.db';
  };

  /** JSON of the `where` from the most recent findMany call for a model. */
  const whereJson = (model: { findMany: ReturnType<typeof mock> }): string =>
    JSON.stringify(
      (model.findMany.mock.calls.at(-1)?.[0] as { where?: unknown } | undefined)?.where ?? {},
    );

  test('PostgreSQL: 全タイプ(task/note/comment/resource)の where に mode:insensitive が付く', async () => {
    setPostgres();
    const res = await app.handle(
      new Request('http://localhost/search/?q=TEST&type=task,note,comment,resource'),
    );
    expect(res.status).toBe(200);
    expect(whereJson(mockPrisma.task)).toContain('"mode":"insensitive"');
    expect(whereJson(mockPrisma.pomodoroSession)).toContain('"mode":"insensitive"');
    expect(whereJson(mockPrisma.timeEntry)).toContain('"mode":"insensitive"');
    expect(whereJson(mockPrisma.comment)).toContain('"mode":"insensitive"');
    expect(whereJson(mockPrisma.resource)).toContain('"mode":"insensitive"');
  });

  test('SQLite: 全タイプの where に mode を付けない（実行時 PrismaClientValidationError を回避）', async () => {
    setSqlite();
    const res = await app.handle(
      new Request('http://localhost/search/?q=TEST&type=task,note,comment,resource'),
    );
    expect(res.status).toBe(200);
    expect(whereJson(mockPrisma.task)).not.toContain('mode');
    expect(whereJson(mockPrisma.pomodoroSession)).not.toContain('mode');
    expect(whereJson(mockPrisma.timeEntry)).not.toContain('mode');
    expect(whereJson(mockPrisma.comment)).not.toContain('mode');
    expect(whereJson(mockPrisma.resource)).not.toContain('mode');
  });

  test('SQLite: contains 語はクエリそのまま（マッチングは SQLite の既定 LIKE による非区別）', async () => {
    setSqlite();
    await app.handle(new Request('http://localhost/search/?q=test&type=task'));
    expect(whereJson(mockPrisma.task)).toContain('"contains":"test"');
    resetAllMocks();
    await app.handle(new Request('http://localhost/search/?q=TEST&type=task'));
    expect(whereJson(mockPrisma.task)).toContain('"contains":"TEST"');
  });

  test('suggest PostgreSQL: task/comment の where に mode:insensitive が付く', async () => {
    setPostgres();
    const res = await app.handle(new Request('http://localhost/search/suggest?q=Te'));
    expect(res.status).toBe(200);
    expect(whereJson(mockPrisma.task)).toContain('"mode":"insensitive"');
    expect(whereJson(mockPrisma.comment)).toContain('"mode":"insensitive"');
  });

  test('suggest SQLite: mode を付けない', async () => {
    setSqlite();
    const res = await app.handle(new Request('http://localhost/search/suggest?q=Te'));
    expect(res.status).toBe(200);
    expect(whereJson(mockPrisma.task)).not.toContain('mode');
    expect(whereJson(mockPrisma.comment)).not.toContain('mode');
  });
});
