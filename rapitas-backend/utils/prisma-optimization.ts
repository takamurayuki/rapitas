import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

// クエリ最適化のユーティリティ
export class PrismaOptimizer {
  // 選択フィールドの最適化
  static selectFields<T>(fields: (keyof T)[]): Record<keyof T, boolean> {
    return fields.reduce(
      (acc, field) => {
        acc[field] = true;
        return acc;
      },
      {} as Record<keyof T, boolean>,
    );
  }

  // バッチ処理の最適化
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

  // 並列クエリの実行
  static async parallelQueries<T extends Record<string, Promise<any>>>(
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

  // カーソルベースのページネーション
  static cursorPagination<T extends { id: string | number }>(
    cursor?: string,
    limit: number = 20,
  ) {
    return {
      take: limit + 1,
      ...(cursor && {
        cursor: { id: parseInt(cursor) },
        skip: 1,
      }),
    };
  }

  // 結果のフォーマット
  static formatCursorResults<T extends { id: string | number }>(
    items: T[],
    limit: number,
  ) {
    const hasNextPage = items.length > limit;
    const data = hasNextPage ? items.slice(0, -1) : items;
    const nextCursor = hasNextPage
      ? String(data[data.length - 1]?.id)
      : undefined;

    return {
      data,
      nextCursor,
      hasNextPage,
    };
  }
}

// Prismaミドルウェアの拡張
export function setupPrismaOptimizations(prisma: PrismaClient) {
  // クエリのロギングとパフォーマンス計測
  (prisma as any).$use(async (params, next) => {
    const before = Date.now();
    const result = await next(params);
    const after = Date.now();
    const duration = after - before;

    // 遅いクエリの検出
    if (duration > 100) {
      console.warn(
        `Slow query detected: ${params.model}.${params.action} took ${duration}ms`,
      );
    }

    // メトリクスの記録（実際のアプリケーションではメトリクスサービスに送信）
    if (global.performanceMetrics) {
      global.performanceMetrics.recordQuery({
        model: params.model,
        action: params.action,
        duration,
      });
    }

    return result;
  });

  // 自動的なリトライロジック
  (prisma as any).$use(async (params, next) => {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        return await next(params);
      } catch (error: any) {
        retries++;

        // トランザクションのデッドロックやタイムアウトの場合にリトライ
        if (
          error.code === "P2034" || // トランザクションのタイムアウト
          error.code === "P2024" || // タイムアウト
          (error.code === "P2002" && retries < maxRetries) // ユニーク制約違反（リトライ可能な場合）
        ) {
          console.log(
            `Retrying query (${retries}/${maxRetries}): ${params.model}.${params.action}`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, retries) * 100),
          );
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Query failed after ${maxRetries} retries`);
  });
}

// 効率的なデータローダー
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
    // キャッシュチェック
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    // プロミスを作成してキャッシュ
    const promise = new Promise<T | null>((resolve) => {
      this.batchQueue.push({ id, resolve });

      // バッチ処理のスケジュール
      if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(() => this.flush(), this.batchDelay);
      }

      // バッチサイズに達したら即座に実行
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
      console.error("DataLoader error:", error);
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

// 複雑なクエリの最適化ヘルパー
export const QueryOptimizers = {
  // N+1問題を回避するための関連データの事前読み込み
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
        select: { id: true, startTime: true, endTime: true, duration: true },
        orderBy: { startTime: "desc" as const } as any,
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

  // 集計クエリの最適化
  async getTaskStatistics(prisma: any, filters: any) {
    const results = await PrismaOptimizer.parallelQueries({
      totalCount: prisma.task.count({ where: filters }),
      statusCounts: prisma.task.groupBy({
        by: ["status"],
        where: filters,
        _count: { status: true },
      }),
      priorityCounts: prisma.task.groupBy({
        by: ["priority"],
        where: filters,
        _count: { priority: true },
      }),
      overdueTasks: prisma.task.count({
        where: {
          ...filters,
          dueDate: { lt: new Date() },
          status: { not: "completed" },
        },
      }),
      upcomingTasks: prisma.task.findMany({
        where: {
          ...filters,
          dueDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
          status: { not: "completed" },
        },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
        take: 5,
      }),
    });

    return {
      total: results.totalCount,
      byStatus: Object.fromEntries(
        results.statusCounts.map((s: any) => [s.status, s._count.status]),
      ),
      byPriority: Object.fromEntries(
        results.priorityCounts.map((p: any) => [p.priority, p._count.priority]),
      ),
      overdue: results.overdueTasks,
      upcoming: results.upcomingTasks,
    };
  },

  // 効率的な検索クエリ
  searchTasks: (searchTerm: string, filters: any = {}) => ({
    where: {
      AND: [
        filters,
        {
          OR: [
            { title: { contains: searchTerm, mode: "insensitive" as const } },
            {
              description: {
                contains: searchTerm,
                mode: "insensitive" as const,
              },
            },
            {
              labels: {
                some: {
                  label: {
                    name: {
                      contains: searchTerm,
                      mode: "insensitive" as const,
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
};

// グローバルな型定義
declare global {
  var performanceMetrics: {
    recordQuery: (data: {
      model?: string;
      action: string;
      duration: number;
    }) => void;
  };
}
