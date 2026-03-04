import { Elysia, t, type Context } from "elysia";
import { prisma } from "../../config";
import { cacheService, CacheKeys } from "../../services/cache-service";
import { PrismaOptimizer, QueryOptimizers } from "../../utils/prisma-optimization";
import { performanceMonitoring } from "../../middleware/performance";

// バッチ処理の結果型
interface BatchResult {
  id: string;
  status: number;
  body?: string | object;
  error?: string;
  cached?: boolean;
  executionTime?: number;
}

// リクエストハンドラーのレジストリ
const requestHandlers = new Map<
  string,
  (params: { query?: any; params?: any; body?: any }) => Promise<any>
>();

// ハンドラーを登録
function registerHandler(
  pattern: string,
  handler: (params: { query?: any; params?: any; body?: any }) => Promise<any>,
) {
  requestHandlers.set(pattern, handler);
}

// 最適化されたハンドラーを登録
registerHandler("GET:/tasks", async (context: any) => {
      const { query  } = context;
  const cacheKey = CacheKeys.taskList(query);

  // キャッシュから取得を試みる
  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  // クエリパラメータの解析
  const { categoryId,
    status,
    since,
    cursor,
    limit = 20,
    search,
    projectId,
    priority,
   } = query as any;

  // フィルター構築
  const where: Record<string, any> = {};
  if (categoryId) where.categoryId = parseInt(categoryId);
  if (status) where.status = status;
  if (projectId) where.projectId = parseInt(projectId);
  if (priority) where.priority = priority;

  // インクリメンタル更新の場合
  if (since) {
    const results = await PrismaOptimizer.parallelQueries({
      tasks: prisma.task.findMany({
        where: {
          ...where,
          updatedAt: { gte: new Date(since) },
        },
        ...QueryOptimizers.taskWithRelations(),
        orderBy: { updatedAt: "desc" },
      }),
      totalCount: prisma.task.count({ where }),
      activeIds: prisma.task.findMany({
        where,
        select: { id: true },
      }),
    });

    const result = {
      tasks: results.tasks,
      totalCount: results.totalCount,
      activeIds: results.activeIds.map((t: { id: number }) => t.id),
      since,
      incremental: true,
    };

    // 短期間キャッシュ（インクリメンタル更新は頻繁に変わるため）
    await cacheService.set(cacheKey, result, CacheKeys.TTL.SHORT);
    return result;
  }

  // 検索の場合
  if (search) {
    const searchQuery = QueryOptimizers.searchTasks(search, where);
    const results = await prisma.task.findMany({
      ...searchQuery,
      ...PrismaOptimizer.cursorPagination(cursor, parseInt(limit)),
      orderBy: { createdAt: "desc" },
    });

    const formatted = PrismaOptimizer.formatCursorResults(
      results,
      parseInt(limit),
    );
    await cacheService.set(cacheKey, formatted, CacheKeys.TTL.MEDIUM);
    return formatted;
  }

  // 通常のページネーション
  const results = await prisma.task.findMany({
    where,
    ...QueryOptimizers.taskWithRelations(),
    ...PrismaOptimizer.cursorPagination(cursor, parseInt(limit)),
    orderBy: { createdAt: "desc" },
  });

  const formatted = PrismaOptimizer.formatCursorResults(
    results,
    parseInt(limit),
  );
  await cacheService.set(cacheKey, formatted, CacheKeys.TTL.MEDIUM);
  return formatted;
});

registerHandler("GET:/tasks/:id", async (context: any) => {
      const { params  } = context;
  const id = parseInt(params.id);
  const cacheKey = CacheKeys.task(params.id);

  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const task = await prisma.task.findUnique({
    where: { id },
    ...QueryOptimizers.taskWithRelations(),
  });

  if (task) {
    await cacheService.set(cacheKey, task, CacheKeys.TTL.MEDIUM);
  }

  return task;
});

registerHandler("GET:/statistics/tasks", async () => {
  const cacheKey = CacheKeys.statistics("tasks");

  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const stats = await QueryOptimizers.getTaskStatistics(prisma, {});

  await cacheService.set(cacheKey, stats, CacheKeys.TTL.LONG);
  return stats;
});

registerHandler("POST:/tasks", async (context: any) => {
      const { body  } = context;
  const task = await prisma.task.create({
    data: body,
    ...QueryOptimizers.taskWithRelations(),
  });

  // 関連するキャッシュを無効化
  await cacheService.clear("tasks:");
  await cacheService.clear("stats:");

  return task;
});

registerHandler("PATCH:/tasks/:id", async (context: any) => {
      const { params, body  } = context;
  const id = parseInt(params.id);
  const task = await prisma.task.update({
    where: { id },
    data: body,
    ...QueryOptimizers.taskWithRelations(),
  });

  // 特定のタスクキャッシュを無効化
  await cacheService.delete(CacheKeys.task(params.id));
  await cacheService.clear("tasks:");
  await cacheService.clear("stats:");

  return task;
});

registerHandler("DELETE:/tasks/:id", async (context: any) => {
      const { params  } = context;
  const id = parseInt(params.id);
  await prisma.task.delete({ where: { id } });

  // キャッシュを無効化
  await cacheService.delete(CacheKeys.task(params.id));
  await cacheService.clear("tasks:");
  await cacheService.clear("stats:");

  return { success: true };
});

// バッチプロセッサー
class BatchProcessor {
  private concurrencyLimit: number;
  private queue: Array<() => Promise<BatchResult>> = [];

  constructor(concurrencyLimit = 10) {
    this.concurrencyLimit = concurrencyLimit;
  }

  async processRequests(
    requests: Array<{
      id: string;
      method: string;
      url: string;
      body?: any;
    }>,
  ): Promise<BatchResult[]> {
    // リクエストをキューに追加
    const promises = requests.map((request) =>
      this.createRequestProcessor(request),
    );

    // 同時実行数を制限しながら処理
    const results: BatchResult[] = [];

    for (let i = 0; i < promises.length; i += this.concurrencyLimit) {
      const batch = promises.slice(i, i + this.concurrencyLimit);
      const batchResults = await Promise.all(batch.map((fn) => fn()));
      results.push(...batchResults);
    }

    return results;
  }

  private createRequestProcessor(request: {
    id: string;
    method: string;
    url: string;
    body?: any;
  }) {
    return async (): Promise<BatchResult> => {
      const startTime = performance.now();

      try {
        // URLを解析
        const urlParts = request.url.split("?");
        const pathParts = urlParts[0].replace(/^\//, "").split("/");
        const query = urlParts[1]
          ? Object.fromEntries(new URLSearchParams(urlParts[1]))
          : {};

        // パスパラメータを抽出
        const handlerKey = this.buildHandlerKey(request.method, pathParts);
        const handler = this.findHandler(handlerKey);

        if (!handler) {
          throw new Error(
            `No handler found for ${request.method} ${request.url}`,
          );
        }

        // ハンドラーを実行
        const result = await handler.handler({
          params: handler.params,
          query,
          body: request.body,
        });

        const executionTime = performance.now() - startTime;

        return {
          id: request.id,
          status: 200,
          body: result,
          cached: result.cached || false,
          executionTime,
        };
      } catch (error: any) {
        const executionTime = performance.now() - startTime;

        return {
          id: request.id,
          status: error.status || 500,
          error: error.message || "Internal server error",
          executionTime,
        };
      }
    };
  }

  private buildHandlerKey(method: string, pathParts: string[]): string {
    // パスをパターンに変換（例: tasks/123 -> tasks/:id）
    const pattern = pathParts
      .map((part, index) => {
        if (/^\d+$/.test(part) && index > 0) {
          return ":id";
        }
        return part;
      })
      .join("/");

    return `${method}:/${pattern}`;
  }

  private findHandler(key: string): { handler: any; params: any } | null {
    // 完全一致を試みる
    if (requestHandlers.has(key)) {
      return { handler: requestHandlers.get(key), params: {} };
    }

    // パターンマッチングを試みる
    for (const [pattern, handler] of Array.from(requestHandlers)) {
      const regex = this.patternToRegex(pattern);
      const match = key.match(regex);

      if (match) {
        const params: Record<string, string> = {};
        const paramNames = pattern.match(/:(\w+)/g);

        if (paramNames) {
          paramNames.forEach((param, index) => {
            const paramName = param.substring(1);
            params[paramName] = match[index + 1];
          });
        }

        return { handler, params };
      }
    }

    return null;
  }

  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:(\w+)/g, "(\\w+)");
    return new RegExp(`^${escaped}$`);
  }
}

// バッチ処理インスタンス
const batchProcessor = new BatchProcessor();

// 最適化されたバッチエンドポイント
export const batchRoutesV2 = new Elysia({ prefix: "/batch/v2" })
  .use(performanceMonitoring)
  .post(
    "/",
    async (context: any) => {
      const { body, set  } = context;
      const typedBody = body as {
        requests: Array<{
          id: string;
          method: string;
          path: string;
          params?: any;
        }>;
      };
      const results = await batchProcessor.processRequests(
        typedBody.requests.map((req) => ({
          id: req.id,
          method: req.method,
          url: req.path,
          body: req.params,
        })),
      );

      // 実行統計を追加
      const totalTime = results.reduce(
        (sum, r) => sum + (r.executionTime || 0),
        0,
      );
      const cachedCount = results.filter((r) => r.cached).length;

      set.headers["x-batch-total-time"] = `${totalTime.toFixed(2)}ms`;
      set.headers["x-batch-cached-count"] = cachedCount.toString();

      return {
        results,
        metadata: {
          totalRequests: results.length,
          successCount: results.filter((r) => r.status === 200).length,
          errorCount: results.filter((r) => r.status !== 200).length,
          cachedCount,
          totalExecutionTime: totalTime,
          averageExecutionTime: totalTime / results.length,
        },
      };
    },
    {
      body: t.Object({
        requests: t.Array(
          t.Object({
            id: t.String(),
            method: t.Union([
              t.Literal("GET"),
              t.Literal("POST"),
              t.Literal("PUT"),
              t.Literal("PATCH"),
              t.Literal("DELETE"),
            ]),
            path: t.String(),
            params: t.Optional(t.Any()),
          }),
        ),
      }),
      detail: {
        tags: ["Batch"],
        summary: "Optimized batch API with caching and parallel processing",
        description:
          "Process multiple API requests with intelligent caching, parallel execution, and performance monitoring",
      },
    },
  )
  .get(
    "/stats",
    async () => {
      const cacheStats = cacheService.getStats();
      return {
        cache: cacheStats,
        handlers: Array.from(requestHandlers.keys()),
      };
    },
    {
      detail: {
        tags: ["Batch"],
        summary: "Get batch processing statistics",
        description: "View cache hit rates and registered handlers",
      },
    },
  );
