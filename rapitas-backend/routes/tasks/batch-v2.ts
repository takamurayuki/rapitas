import { Elysia, t } from 'elysia';
import { prisma } from '../../config';
import { cacheService, CacheKeys } from '../../services/core/cache-service';
import { PrismaOptimizer, QueryOptimizers } from '../../utils/database/prisma-optimization';
import { performanceMonitoring } from '../../middleware/performance';
import { deleteTaskWithTrash } from '../../services/task/task-deletion';
import { NotFoundError, ValidationError } from '../../middleware/error-handler';

interface BatchResult {
  id: string;
  status: number;
  body?: string | object;
  error?: string;
  cached?: boolean;
  executionTime?: number;
}

type HandlerContext = {
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: unknown;
};

const requestHandlers = new Map<string, (params: HandlerContext) => Promise<unknown>>();

/**
 * Parse a task id from a batch path segment, refusing anything non-numeric.
 *
 * NOTE(#1335 review): every id-taking handler here did a bare `parseInt` and
 * handed the result to Prisma, so `/tasks/abc` sent `NaN` into the query
 * layer. Prisma rejects that, and the batch API therefore disagreed with the
 * direct route, which answers 400 from its own `isNaN` check. Validating
 * before the DB keeps the two consistent and keeps NaN out of the database
 * layer entirely — a test asserting what NaN *did* downstream was pinning the
 * defect rather than the contract.
 *
 * @param raw - The `:id` path segment / パスの :id 部分
 * @returns The parsed id / 解析した id
 * @throws {ValidationError} When it is not a number / 数値でない場合
 */
function parseTaskId(raw: string): number {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id)) throw new ValidationError(`Invalid task id: ${raw}`);
  return id;
}

function registerHandler(pattern: string, handler: (params: HandlerContext) => Promise<unknown>) {
  requestHandlers.set(pattern, handler);
}

registerHandler('GET:/tasks', async (context) => {
  const { query } = context;
  const cacheKey = CacheKeys.taskList(query ?? {});

  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const {
    categoryId,
    status,
    since,
    cursor,
    limit = '20',
    search,
    projectId,
    priority,
  } = query as Record<string, string>;

  const where: Record<string, unknown> = {};
  if (categoryId) where.categoryId = parseInt(categoryId);
  if (status) where.status = status;
  if (projectId) where.projectId = parseInt(projectId);
  if (priority) where.priority = priority;

  // Incremental update
  if (since) {
    const results = await PrismaOptimizer.parallelQueries({
      tasks: prisma.task.findMany({
        where: {
          ...where,
          updatedAt: { gte: new Date(since) },
        },
        ...QueryOptimizers.taskWithRelations(),
        orderBy: { updatedAt: 'desc' },
      } as Parameters<typeof prisma.task.findMany>[0]),
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

    // Short-lived cache (incremental updates change frequently)
    await cacheService.set(cacheKey, result, CacheKeys.TTL.SHORT);
    return result;
  }

  if (search) {
    const searchQuery = QueryOptimizers.searchTasks(search, where);
    const results = await prisma.task.findMany({
      ...searchQuery,
      ...PrismaOptimizer.cursorPagination(cursor, parseInt(limit)),
      orderBy: { createdAt: 'desc' },
    } as Parameters<typeof prisma.task.findMany>[0]);

    const formatted = PrismaOptimizer.formatCursorResults(results, parseInt(limit));
    await cacheService.set(cacheKey, formatted, CacheKeys.TTL.MEDIUM);
    return formatted;
  }

  const results = await prisma.task.findMany({
    where,
    ...QueryOptimizers.taskWithRelations(),
    ...PrismaOptimizer.cursorPagination(cursor, parseInt(limit)),
    orderBy: { createdAt: 'desc' },
  } as Parameters<typeof prisma.task.findMany>[0]);

  const formatted = PrismaOptimizer.formatCursorResults(results, parseInt(limit));
  await cacheService.set(cacheKey, formatted, CacheKeys.TTL.MEDIUM);
  return formatted;
});

registerHandler('GET:/tasks/:id', async (context) => {
  const { params } = context;
  const id = parseTaskId(params!.id);
  const cacheKey = CacheKeys.task(params!.id);

  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const task = await prisma.task.findUnique({
    where: { id },
    ...QueryOptimizers.taskWithRelations(),
  } as Parameters<typeof prisma.task.findUnique>[0]);

  // NOTE(#1335): 404, matching the Elysia route. These are two separate
  // implementations of `GET /tasks/:id` and both answered 200 with a null
  // body for a missing id; fixing one and not the other would leave the batch
  // API disagreeing with the direct route about whether a task exists. The
  // dispatcher maps a thrown AppError to `status: err.status`, so this
  // surfaces as a per-request 404 rather than failing the whole batch.
  if (!task) throw new NotFoundError(`Task ${id} not found`);

  await cacheService.set(cacheKey, task, CacheKeys.TTL.MEDIUM);
  return task;
});

registerHandler('GET:/statistics/tasks', async () => {
  const cacheKey = CacheKeys.statistics('tasks');

  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return { data: cached, cached: true };
  }

  const stats = await QueryOptimizers.getTaskStatistics(prisma, {});

  await cacheService.set(cacheKey, stats, CacheKeys.TTL.LONG);
  return stats;
});

registerHandler('POST:/tasks', async (context) => {
  const { body } = context;
  const task = await prisma.task.create({
    data: body as Parameters<typeof prisma.task.create>[0]['data'],
    ...QueryOptimizers.taskWithRelations(),
  } as Parameters<typeof prisma.task.create>[0]);

  // Invalidate related caches
  await cacheService.clear('tasks:');
  await cacheService.clear('stats:');

  return task;
});

registerHandler('PATCH:/tasks/:id', async (context) => {
  const { params, body } = context;
  const id = parseTaskId(params!.id);
  const task = await prisma.task.update({
    where: { id },
    data: body as Parameters<typeof prisma.task.update>[0]['data'],
    ...QueryOptimizers.taskWithRelations(),
  } as Parameters<typeof prisma.task.update>[0]);

  // Invalidate specific task cache
  await cacheService.delete(CacheKeys.task(params!.id));
  await cacheService.clear('tasks:');
  await cacheService.clear('stats:');

  return task;
});

registerHandler('DELETE:/tasks/:id', async (context) => {
  const { params } = context;
  const id = parseTaskId(params!.id);

  // NOTE(#1330): Through the choke point, not `prisma.task.delete`. This
  // handler used to delete directly, so a task the single-task route refuses
  // as protected was removed here instead — with no trash copy to restore
  // from and no measurement snapshot, while the cascade took 43 relations.
  // A batch request is not a reason to skip a guard.
  const result = await deleteTaskWithTrash(id, 'user');
  if (result.outcome === 'protected') {
    throw new Error('保護されたタスクは削除できません');
  }
  if (result.outcome === 'not_found') {
    throw new Error('タスクが見つかりません');
  }

  // Invalidate caches
  await cacheService.delete(CacheKeys.task(params!.id));
  await cacheService.clear('tasks:');
  await cacheService.clear('stats:');

  return { success: true, trashId: result.trashId };
});

class BatchProcessor {
  private concurrencyLimit: number;
  // NOTE: Removed unused `queue` member — processRequests chunks its input
  // directly and nothing ever enqueued to it (noUnusedLocals).

  constructor(concurrencyLimit = 10) {
    this.concurrencyLimit = concurrencyLimit;
  }

  async processRequests(
    requests: Array<{
      id: string;
      method: string;
      url: string;
      body?: unknown;
    }>,
  ): Promise<BatchResult[]> {
    const promises = requests.map((request) => this.createRequestProcessor(request));

    // Process with concurrency limit
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
    body?: unknown;
  }) {
    return async (): Promise<BatchResult> => {
      const startTime = performance.now();

      try {
        const urlParts = request.url.split('?');
        const pathParts = urlParts[0].replace(/^\//, '').split('/');
        const query = urlParts[1] ? Object.fromEntries(new URLSearchParams(urlParts[1])) : {};

        const handlerKey = this.buildHandlerKey(request.method, pathParts);
        const handler = this.findHandler(handlerKey);

        if (!handler) {
          throw new Error(`No handler found for ${request.method} ${request.url}`);
        }

        const result = await handler.handler({
          params: handler.params,
          query,
          body: request.body,
        });

        const executionTime = performance.now() - startTime;

        return {
          id: request.id,
          status: 200,
          body: result as string | object,
          // NOTE: result can be `null` (e.g. GET /tasks/:id for a missing task) —
          // `null.cached` throws, which used to bounce this branch into the catch
          // block and turn a legitimate 200/null response into a 500.
          cached: (result as { cached?: boolean } | null)?.cached || false,
          executionTime,
        };
      } catch (error: unknown) {
        const executionTime = performance.now() - startTime;
        // NOTE(#1335): `statusCode` first. AppError (and so every
        // ValidationError / NotFoundError in this codebase) carries its status
        // as `statusCode`; reading only `status` meant EVERY deliberate error
        // a handler threw was reported as a 500. `status` is kept as a
        // fallback for plain objects that use that name.
        const err = error as { statusCode?: number; status?: number; message?: string };
        return {
          id: request.id,
          status: err.statusCode ?? err.status ?? 500,
          error: err.message || 'Internal server error',
          executionTime,
        };
      }
    };
  }

  private buildHandlerKey(method: string, pathParts: string[]): string {
    // NOTE: Do NOT pre-substitute numeric segments to ':id' here. Doing so made
    // this key collide with the registered pattern string itself (e.g.
    // "GET:/tasks/5" -> "GET:/tasks/:id"), which hit the `requestHandlers.has()`
    // exact-match branch in findHandler() and returned `params: {}` — silently
    // discarding the real id and turning every /tasks/:id lookup into
    // `where: { id: NaN }`. Keeping the raw value here forces parameterized
    // routes through the regex fallback in findHandler(), which extracts the
    // real id correctly.
    return `${method}:/${pathParts.join('/')}`;
  }

  private findHandler(key: string): {
    handler: (params: HandlerContext) => Promise<unknown>;
    params: Record<string, string>;
  } | null {
    if (requestHandlers.has(key)) {
      return { handler: requestHandlers.get(key)!, params: {} };
    }

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
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, '(\\w+)');
    return new RegExp(`^${escaped}$`);
  }
}

const batchProcessor = new BatchProcessor();

export const batchRoutesV2 = new Elysia({ prefix: '/batch/v2' })
  .use(performanceMonitoring)
  .post(
    '/',
    async (context) => {
      const { body, set } = context;
      const typedBody = body as {
        requests: Array<{
          id: string;
          method: string;
          path: string;
          params?: unknown;
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

      const totalTime = results.reduce((sum, r) => sum + (r.executionTime || 0), 0);
      const cachedCount = results.filter((r) => r.cached).length;

      set.headers['x-batch-total-time'] = `${totalTime.toFixed(2)}ms`;
      set.headers['x-batch-cached-count'] = cachedCount.toString();

      return {
        results,
        metadata: {
          totalRequests: results.length,
          successCount: results.filter((r) => r.status === 200).length,
          errorCount: results.filter((r) => r.status !== 200).length,
          cachedCount,
          totalExecutionTime: totalTime,
          // NOTE: an empty `requests` array made this 0/0 = NaN, which
          // JSON.stringify silently drops to `null` in the response body.
          averageExecutionTime: results.length > 0 ? totalTime / results.length : 0,
        },
      };
    },
    {
      body: t.Object({
        requests: t.Array(
          t.Object({
            id: t.String(),
            method: t.Union([
              t.Literal('GET'),
              t.Literal('POST'),
              t.Literal('PUT'),
              t.Literal('PATCH'),
              t.Literal('DELETE'),
            ]),
            path: t.String(),
            params: t.Optional(t.Any()),
          }),
        ),
      }),
      detail: {
        tags: ['Batch'],
        summary: 'Optimized batch API with caching and parallel processing',
        description:
          'Process multiple API requests with intelligent caching, parallel execution, and performance monitoring',
      },
    },
  )
  .get(
    '/stats',
    async () => {
      const cacheStats = cacheService.getStats();
      return {
        cache: cacheStats,
        handlers: Array.from(requestHandlers.keys()),
      };
    },
    {
      detail: {
        tags: ['Batch'],
        summary: 'Get batch processing statistics',
        description: 'View cache hit rates and registered handlers',
      },
    },
  );
