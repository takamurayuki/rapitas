import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../../config/logger';

const log = createLogger('prisma-optimization');

// Query optimization utilities
export class PrismaOptimizer {
  // Optimize field selection
  static selectFields<T>(fields: (keyof T)[]): Record<keyof T, boolean> {
    return fields.reduce(
      (acc, field) => {
        acc[field] = true;
        return acc;
      },
      {} as Record<keyof T, boolean>,
    );
  }

  // Optimize batch processing
  static async batchOperation<T>(
    items: T[],
    batchSize: number,
    operation: (batch: T[]) => Promise<void>,
  ): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await operation(batch);
    }
  }

  // Execute queries in parallel
  static async parallelQueries<T extends Record<string, Promise<unknown>>>(
    queries: T,
  ): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
    const keys = Object.keys(queries) as (keyof T)[];
    const promises = keys.map((key) => queries[key]);
    const results = await Promise.all(promises);

    return keys.reduce(
      (acc, key, index) => {
        acc[key] = results[index];
        return acc;
      },
      {} as { [K in keyof T]: Awaited<T[K]> },
    );
  }

  // Cursor-based pagination
  static cursorPagination<T extends { id: string | number }>(cursor?: string, limit: number = 20) {
    return {
      take: limit + 1,
      ...(cursor && {
        cursor: { id: parseInt(cursor) },
        skip: 1,
      }),
    };
  }

  // Format cursor pagination results
  static formatCursorResults<T extends { id: string | number }>(items: T[], limit: number) {
    const hasNextPage = items.length > limit;
    const data = hasNextPage ? items.slice(0, -1) : items;
    const nextCursor = hasNextPage ? String(data[data.length - 1]?.id) : undefined;

    return {
      data,
      nextCursor,
      hasNextPage,
    };
  }
}

// Prisma middleware params type (deprecated in newer versions)
interface MiddlewareParams {
  model?: string;
  action: string;
  args: Record<string, unknown>;
  dataPath: string[];
  runInTransaction: boolean;
}

type PrismaMiddlewareFn = (
  params: MiddlewareParams,
  next: (params: MiddlewareParams) => Promise<unknown>,
) => Promise<unknown>;
type PrismaWithUse = PrismaClient & { $use: (fn: PrismaMiddlewareFn) => void };

// Prisma middleware extensions
export function setupPrismaOptimizations(prisma: PrismaClient) {
  const prismaWithMiddleware = prisma as unknown as PrismaWithUse;
  // Query logging and performance measurement
  // Note: $use middleware is deprecated in newer Prisma versions, using type assertion
  prismaWithMiddleware.$use(
    async (params: MiddlewareParams, next: (params: MiddlewareParams) => Promise<unknown>) => {
      const before = Date.now();
      const result = await next(params);
      const after = Date.now();
      const duration = after - before;

      // Detect slow queries
      if (duration > 100) {
        log.warn(`Slow query detected: ${params.model}.${params.action} took ${duration}ms`);
      }

      // Record metrics (in production, send to a metrics service)
      if (global.performanceMetrics) {
        global.performanceMetrics.recordQuery({
          model: params.model,
          action: params.action,
          duration,
        });
      }

      return result;
    },
  );

  // Automatic retry logic
  prismaWithMiddleware.$use(
    async (params: MiddlewareParams, next: (params: MiddlewareParams) => Promise<unknown>) => {
      const maxRetries = 3;
      let retries = 0;

      while (retries < maxRetries) {
        try {
          return await next(params);
        } catch (error: unknown) {
          retries++;

          const prismaError = error as { code?: string };
          // Retry on transaction deadlocks and timeouts
          if (
            prismaError.code === 'P2034' || // Transaction timeout
            prismaError.code === 'P2024' || // Query timeout
            (prismaError.code === 'P2002' && retries < maxRetries) // Unique constraint violation (retryable)
          ) {
            log.info(`Retrying query (${retries}/${maxRetries}): ${params.model}.${params.action}`);
            await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries) * 100));
            continue;
          }

          throw error;
        }
      }

      throw new Error(`Query failed after ${maxRetries} retries`);
    },
  );
}

// Efficient data loader with batching
export class PrismaDataLoader<T> {
  private cache = new Map<string, Promise<T | null>>();
  private batchQueue: { id: string; resolve: (value: T | null) => void }[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;

  constructor(
    private loader: (ids: string[]) => Promise<Map<string, T>>,
    private batchSize = 100,
    private batchDelay = 10,
  ) {}

  async load(id: string): Promise<T | null> {
    // Cache check
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    // Create a promise and cache it
    const promise = new Promise<T | null>((resolve) => {
      this.batchQueue.push({ id, resolve });

      // Schedule batch processing
      if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(() => this.flush(), this.batchDelay);
      }

      // Execute immediately when batch size is reached
      if (this.batchQueue.length >= this.batchSize) {
        this.flush();
      }
    });

    this.cache.set(id, promise);
    return promise;
  }

  private async flush() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    const batch = this.batchQueue.splice(0, this.batchSize);
    if (batch.length === 0) return;

    const ids = batch.map((item) => item.id);

    try {
      const results = await this.loader(ids);

      batch.forEach(({ id, resolve }) => {
        resolve(results.get(id) || null);
      });
    } catch (error) {
      batch.forEach(({ resolve }) => resolve(null));
      log.error({ err: error }, 'DataLoader error');
    }
  }

  clearCache(id?: string) {
    if (id) {
      this.cache.delete(id);
    } else {
      this.cache.clear();
    }
  }
}

// Complex query optimization helpers
export const QueryOptimizers = {
  // Eager-load related data to avoid N+1 queries
  taskWithRelations: () => ({
    include: {
      project: {
        select: { id: true, title: true, color: true },
      },
      labels: {
        select: {
          label: {
            select: { id: true, name: true, color: true },
          },
        },
      },
      timeEntries: {
        select: { id: true, startedAt: true, endedAt: true, duration: true },
        orderBy: { startedAt: 'desc' as const },
        take: 5,
      },
      taskDependencies: {
        select: {
          id: true,
          dependsOnTaskId: true,
          dependsOnTask: {
            select: { id: true, title: true, status: true },
          },
        },
      },
      _count: {
        select: { comments: true, timeEntries: true },
      },
    },
  }),

  // Optimized aggregation queries
  async getTaskStatistics(prisma: PrismaClient, filters: Prisma.TaskWhereInput) {
    const results = await PrismaOptimizer.parallelQueries({
      totalCount: prisma.task.count({ where: filters }),
      statusCounts: prisma.task.groupBy({
        by: ['status'],
        where: filters,
        _count: { status: true },
      }),
      priorityCounts: prisma.task.groupBy({
        by: ['priority'],
        where: filters,
        _count: { priority: true },
      }),
      overdueTasks: prisma.task.count({
        where: {
          ...filters,
          dueDate: { lt: new Date() },
          status: { not: 'completed' },
        },
      }),
      upcomingTasks: prisma.task.findMany({
        where: {
          ...filters,
          dueDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
          status: { not: 'completed' },
        },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),
    });

    return {
      total: results.totalCount,
      byStatus: Object.fromEntries(
        results.statusCounts.map((s: { status: string; _count: { status: number } }) => [
          s.status,
          s._count.status,
        ]),
      ),
      byPriority: Object.fromEntries(
        results.priorityCounts.map((p: { priority: string; _count: { priority: number } }) => [
          p.priority,
          p._count.priority,
        ]),
      ),
      overdue: results.overdueTasks,
      upcoming: results.upcomingTasks,
    };
  },

  // Efficient search query
  searchTasks: (searchTerm: string, filters: Prisma.TaskWhereInput = {}) => ({
    where: {
      AND: [
        filters,
        {
          OR: [
            { title: { contains: searchTerm, mode: 'insensitive' as const } },
            {
              description: {
                contains: searchTerm,
                mode: 'insensitive' as const,
              },
            },
            {
              labels: {
                some: {
                  label: {
                    name: {
                      contains: searchTerm,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueDate: true,
      project: { select: { id: true, title: true } },
      _count: { select: { comments: true, timeEntries: true } },
    },
  }),

  // User query with preferences
  userWithPreferences: (_options?: { role?: string }) => ({
    select: {
      id: true,
      username: true,
      email: true,
      preferences: true,
    },
  }),

  // Project with aggregated stats
  projectWithStats: (_dateRange?: { start?: Date; end?: Date }) => ({
    include: {
      _count: {
        select: { tasks: true },
      },
      tasks: {
        select: { status: true },
      },
    },
  }),
};

// Global type declarations
declare global {
  var performanceMetrics: {
    recordQuery: (data: { model?: string; action: string; duration: number }) => void;
  };
}
