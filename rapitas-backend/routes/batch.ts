import { Elysia, t } from "elysia";
import { prisma } from "../config";

/**
 * バッチリクエスト処理
 * 複数のAPI呼び出しを1つのHTTPリクエストで処理
 */
export const batchRoutes = new Elysia({ prefix: "/batch" })
  .post(
    "/",
    async ({ body }) => {
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
          } catch (error: any) {
            return {
              id: request.id,
              status: error.status || 500,
              body: null,
              error: error.message || "Internal server error",
            };
          }
        })
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
          })
        ),
      }),
      detail: {
        tags: ["Batch"],
        summary: "Process multiple API requests in a single HTTP call",
        description: "Reduces network overhead by batching multiple requests",
      },
    }
  );

/**
 * 個別のリクエストを処理
 */
async function processRequest(request: {
  method: string;
  url: string;
  body?: any;
}) {
  const { method, url, body } = request;

  // URLを解析してエンドポイントを特定
  const path = url.replace(/^\//, ""); // 先頭の/を削除
  const pathParts = path.split("/");
  const [resource, ...rest] = pathParts;

  switch (resource) {
    case "tasks":
      return handleTaskRequests(method, rest, body);
    case "categories":
      return handleCategoryRequests(method, rest, body);
    case "themes":
      return handleThemeRequests(method, rest, body);
    case "statistics":
      return handleStatisticsRequests(method, rest, body);
    default:
      throw new Error(`Unknown resource: ${resource}`);
  }
}

/**
 * タスク関連のリクエスト処理
 */
async function handleTaskRequests(
  method: string,
  pathParts: string[],
  body?: any
) {
  const [id, subResource] = pathParts;

  if (method === "GET") {
    if (!id) {
      // GET /tasks
      const queryParams = new URLSearchParams(pathParts.join("/"));
      const categoryId = queryParams.get("categoryId");
      const status = queryParams.get("status");
      const since = queryParams.get("since");

      const where: any = {};
      if (categoryId) where.categoryId = parseInt(categoryId);
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
        const activeIds = await prisma.task.findMany({
          where,
          select: { id: true },
        }).then(tasks => tasks.map(t => t.id));

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

    if (subResource === "dependencies") {
      // GET /tasks/:id/dependencies
      const dependencies = await prisma.taskDependency.findMany({
        where: { taskId: parseInt(id) },
        select: { dependsOnTaskId: true },
      });
      return dependencies.map(d => d.dependsOnTaskId);
    }

    if (subResource === "related") {
      // GET /tasks/:id/related
      const task = await prisma.task.findUnique({
        where: { id: parseInt(id) },
      });
      if (!task) throw new Error("Task not found");

      return prisma.task.findMany({
        where: {
          AND: [
            { id: { not: task.id } },
            { categoryId: task.categoryId },
          ],
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
  body?: any
) {
  if (method === "GET") {
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
  body?: any
) {
  if (method === "GET") {
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
  body?: any
) {
  if (method === "GET" && pathParts[0] === "tasks") {
    const [total, byStatus, byCategory] = await Promise.all([
      prisma.task.count(),
      prisma.task.groupBy({
        by: ["status"],
        _count: true,
      }),
      prisma.task.groupBy({
        by: ["categoryId"],
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
        {}
      ),
      byCategory: byCategory.reduce(
        (acc, item) => ({
          ...acc,
          [item.categoryId]: item._count,
        }),
        {}
      ),
    };
  }
  throw new Error(`Unsupported statistics request`);
}