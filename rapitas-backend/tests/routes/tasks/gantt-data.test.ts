/**
 * Gantt Data Route テスト
 * ガントチャート用タスク取得エンドポイントのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { loggerModuleFactory } from '../../helpers/mock-logger';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', loggerModuleFactory);

const { ganttDataRoute } = await import('../../../routes/tasks/gantt-data');

function resetAllMocks() {
  mockPrisma.task.findMany.mockReset();
}

function createApp() {
  return new Elysia()
    .onError(({ error, set }) => {
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Server error' };
    })
    .use(ganttDataRoute);
}

describe('GET /gantt-data', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('フィルタなしでタスク一覧とメタデータを返すこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/gantt-data'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tasks).toEqual([]);
    expect(body.metadata).toEqual({
      totalTasks: 0,
      dateRange: { from: null, to: null },
      filters: { themeId: null, categoryId: null },
    });
  });

  test('親タスクのみ・archived/cancelled除外の条件でクエリすること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/gantt-data'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { parentId: null; status: { notIn: string[] } };
      take: number;
    };
    expect(call.where.parentId).toBeNull();
    expect(call.where.status.notIn).toEqual(['archived', 'cancelled']);
    expect(call.take).toBe(500);
  });

  test('themeIdクエリでwhere.themeIdを絞り込むこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/gantt-data?themeId=3'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { themeId?: number };
    };
    expect(call.where.themeId).toBe(3);
  });

  test('categoryIdクエリでwhere.theme.categoryIdを絞り込むこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/gantt-data?categoryId=7'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { theme?: { categoryId: number } };
    };
    expect(call.where.theme).toEqual({ categoryId: 7 });
  });

  test('数値化できないthemeIdはNaNとなり絞り込みが適用されないこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/gantt-data?themeId=abc'));
    const body = await res.json();

    // NaN is falsy, so `themeId ? { themeId } : {}` silently drops the filter.
    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { themeId?: number };
    };
    expect(call.where.themeId).toBeUndefined();
    expect(body.metadata.filters.themeId).toBeNull();
  });

  test('fromとtoが両方揃った場合にdueDateの範囲条件を付与すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    const from = '2026-01-01T00:00:00.000Z';
    const to = '2026-01-31T00:00:00.000Z';

    await app.handle(new Request(`http://localhost/gantt-data?from=${from}&to=${to}`));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { OR?: Array<{ dueDate: unknown }> };
    };
    expect(call.where.OR).toBeDefined();
    expect(call.where.OR).toHaveLength(2);
    expect(call.where.OR![1]).toEqual({ dueDate: null });
  });

  test('fromのみでtoが無い場合は日付条件を付与しないこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/gantt-data?from=2026-01-01T00:00:00.000Z'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { OR?: unknown };
    };
    expect(call.where.OR).toBeUndefined();
  });

  test('テーマとカテゴリを含むタスクを整形して返すこと', async () => {
    const dueDate = new Date('2026-02-01T00:00:00.000Z');
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: 1,
        title: 'Task 1',
        status: 'todo',
        dueDate,
        estimatedHours: 3,
        theme: {
          id: 2,
          name: 'Theme A',
          color: '#fff',
          category: { id: 5, name: 'Category A' },
        },
      },
    ]);

    const res = await app.handle(new Request('http://localhost/gantt-data'));
    const body = await res.json();

    expect(body.tasks[0]).toEqual({
      id: 1,
      title: 'Task 1',
      status: 'todo',
      dueDate: dueDate.toISOString(),
      estimatedHours: 3,
      theme: {
        id: 2,
        name: 'Theme A',
        color: '#fff',
        category: { id: 5, name: 'Category A' },
      },
    });
  });

  test('テーマがnullのタスクをtheme:nullとして返すこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: 1,
        title: 'No theme',
        status: 'todo',
        dueDate: null,
        estimatedHours: null,
        theme: null,
      },
    ]);

    const res = await app.handle(new Request('http://localhost/gantt-data'));
    const body = await res.json();

    expect(body.tasks[0].theme).toBeNull();
    expect(body.tasks[0].dueDate).toBeNull();
  });

  test('テーマにカテゴリが無い場合はcategory:nullとして返すこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: 1,
        title: 'Themed, no category',
        status: 'todo',
        dueDate: null,
        estimatedHours: null,
        theme: { id: 2, name: 'Theme A', color: '#fff', category: null },
      },
    ]);

    const res = await app.handle(new Request('http://localhost/gantt-data'));
    const body = await res.json();

    expect(body.tasks[0].theme.category).toBeNull();
  });

  test('prismaがエラーを投げた場合はエラーがハンドラに伝播すること', async () => {
    mockPrisma.task.findMany.mockRejectedValue(new Error('DB down'));

    const res = await app.handle(new Request('http://localhost/gantt-data'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('DB down');
  });
});
