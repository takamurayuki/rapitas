import { Elysia, t, type Context } from 'elysia';
import { prisma } from '../../config';

/**
 * バッチリクエスト処理
 * 複数のAPI呼び出しを1つのHTTPリクエストで処理
 */
export const batchRoutes = new Elysia({ prefix: '/batch' }).post(
  '/',
  async (context) => {
    const { body } = context as {
      body: { requests: Array<{ id: string; method: string; url: string; body?: unknown }> };
    };
    const results = await Promise.all(
      body.requests.map(async (request) => {
        try {
          // リクエストタイプに基づいて処理を分岐
          const result = await processRequest(request);
          return {
            id: request.id,
            status: 200,
            body: result,
          };
        } catch (error: unknown) {
          const err = error as { status?: number; message?: string };
          return {
            id: request.id,
            status: err.status || 500,
            body: null,
            error: err.message || 'Internal server error',
          };
        }
      }),
    );

    return results;
  },
  {
    body: t.Object({
      requests: t.Array(
        t.Object({
          id: t.String(),
          method: t.String(),
          url: t.String(),
          body: t.Optional(t.Any()),
        }),
      ),
    }),
    detail: {
      tags: ['Batch'],
      summary: 'Process multiple API requests in a single HTTP call',
      description: 'Reduces network overhead by batching multiple requests',
    },
  },
);

/**
 * 個別のリクエストを処理
 */
async function processRequest(request: { method: string; url: string; body?: unknown }) {
  const { method, url, body } = request;

  // URLをパス部分とクエリ文字列に分離
  const [rawPath, queryString] = url.split('?');
  const path = rawPath.replace(/^\//, ''); // 先頭の/を削除
  const pathParts = path.split('/');
  const [resource, ...rest] = pathParts;
  const query = new URLSearchParams(queryString || '');

  switch (resource) {
    case 'tasks':
      return handleTaskRequests(method, rest, body, query);
    case 'categories':
      return handleCategoryRequests(method, rest, body, query);
    case 'themes':
      return handleThemeRequests(method, rest, body, query);
    case 'statistics':
      return handleStatisticsRequests(method, rest, body, query);
    default:
      throw new Error(`Unknown resource: ${resource} (URL was: ${url})`);
  }
}

/**
 * タスク関連のリクエスト処理
 */
async function handleTaskRequests(
  method: string,
  pathParts: string[],
  body?: unknown,
  query?: URLSearchParams,
) {
  const [id, subResource] = pathParts;

  if (method === 'GET') {
    if (!id) {
      // GET /tasks
      const themeId = query?.get('themeId') ?? null;
      const status = query?.get('status') ?? null;
      const since = query?.get('since') ?? null;

      const where: Record<string, unknown> = {};
      if (themeId) where.themeId = parseInt(themeId);
      if (status) where.status = status;

      if (since) {
        // インクリメンタル更新
        const tasks = await prisma.task.findMany({
          where: {
            ...where,
            updatedAt: { gte: new Date(since) },
          },
        });

        const totalCount = await prisma.task.count({ where });
        const activeIds = await prisma.task
          .findMany({
            where,
            select: { id: true },
          })
          .then((tasks) => tasks.map((t) => t.id));

        return {
          tasks,
          totalCount,
          activeIds,
          since,
          incremental: true,
        };
      }

      return prisma.task.findMany({ where });
    }

    if (subResource === 'dependencies') {
      // GET /tasks/:id/dependencies
      // Note: TaskDependency model not found in schema, returning empty array for now
      return [];
    }

    if (subResource === 'related') {
      // GET /tasks/:id/related
      const task = await prisma.task.findUnique({
        where: { id: parseInt(id) },
      });
      if (!task) throw new Error('Task not found');

      return prisma.task.findMany({
        where: {
          AND: [{ id: { not: task.id } }, { themeId: task.themeId }],
        },
        take: 5,
      });
    }

    // GET /tasks/:id
    return prisma.task.findUnique({
      where: { id: parseInt(id) },
    });
  }

  throw new Error(`Unsupported method: ${method}`);
}

/**
 * カテゴリ関連のリクエスト処理
 */
async function handleCategoryRequests(
  method: string,
  pathParts: string[],
  body?: unknown,
  query?: URLSearchParams,
) {
  if (method === 'GET') {
    return prisma.category.findMany();
  }
  throw new Error(`Unsupported method: ${method}`);
}

/**
 * テーマ関連のリクエスト処理
 */
async function handleThemeRequests(
  method: string,
  pathParts: string[],
  body?: unknown,
  query?: URLSearchParams,
) {
  if (method === 'GET') {
    return prisma.theme.findMany();
  }
  throw new Error(`Unsupported method: ${method}`);
}

/**
 * 統計情報関連のリクエスト処理
 */
async function handleStatisticsRequests(
  method: string,
  pathParts: string[],
  body?: unknown,
  query?: URLSearchParams,
) {
  if (method === 'GET' && pathParts[0] === 'tasks') {
    const [total, byStatus, byCategory] = await Promise.all([
      prisma.task.count(),
      prisma.task.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.task.groupBy({
        by: ['themeId'],
        _count: true,
      }),
    ]);

    return {
      total,
      byStatus: byStatus.reduce(
        (acc, item) => ({
          ...acc,
          [item.status]: item._count,
        }),
        {} as Record<string, number>,
      ),
      byCategory: byCategory.reduce(
        (acc, item) => ({
          ...acc,
          [String(item.themeId)]: item._count,
        }),
        {} as Record<string, number>,
      ),
    };
  }
  throw new Error(`Unsupported statistics request`);
}
