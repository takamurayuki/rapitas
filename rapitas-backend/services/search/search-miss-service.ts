/**
 * Search Miss Service
 *
 * Records and aggregates zero-result search queries (SearchMiss) to surface
 * content gaps and support task-suggestion workflows.
 */

import type { PrismaClient, SearchMiss } from '@prisma/client';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('search-miss-service');

/**
 * Records a failed search query, incrementing the hit count on repeat misses.
 * Queries shorter than 3 characters after normalization are silently ignored.
 *
 * @param rawQuery - Raw query string from the caller / 呼び出し元の生クエリ文字列
 * @returns Resolves when the record has been saved or skipped
 */
export async function recordSearchMiss(rawQuery: string): Promise<void> {
  const normalized = rawQuery.trim().toLowerCase();
  if (normalized.length < 3) return;

  await prisma.searchMiss.upsert({
    where: { query: normalized },
    create: { query: normalized, hitCount: 1, lastSearchedAt: new Date() },
    update: {
      hitCount: { increment: 1 },
      lastSearchedAt: new Date(),
    },
  });

  log.debug({ query: normalized }, 'Recorded search miss');
}

/**
 * Returns the most-frequently missed open queries, ordered by hit count descending.
 *
 * @param limit - Maximum number of records to return / 返すレコードの最大数
 * @returns Array of SearchMiss records / SearchMissレコードの配列
 */
export async function getTopMissedQueries(limit = 10): Promise<SearchMiss[]> {
  return prisma.searchMiss.findMany({
    where: { status: 'open' },
    orderBy: { hitCount: 'desc' },
    take: limit,
  });
}

/** Analytics snapshot broken down by status. */
interface MissAnalytics {
  open: number;
  suggested: number;
  resolved: number;
  topQueries: Array<{ query: string; hitCount: number }>;
}

/**
 * Aggregates SearchMiss counts by status and retrieves the top open queries.
 *
 * @returns Analytics object with per-status counts and top open queries / ステータス別カウントと上位オープンクエリを含む集計オブジェクト
 */
export async function getMissAnalytics(): Promise<MissAnalytics> {
  const [groups, topQueries] = await Promise.all([
    prisma.searchMiss.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.searchMiss.findMany({
      where: { status: 'open' },
      orderBy: { hitCount: 'desc' },
      take: 10,
      select: { query: true, hitCount: true },
    }),
  ]);

  const countByStatus: Record<string, number> = {};
  for (const g of groups) {
    countByStatus[g.status] = g._count.status;
  }

  return {
    open: countByStatus['open'] ?? 0,
    suggested: countByStatus['suggested'] ?? 0,
    resolved: countByStatus['resolved'] ?? 0,
    topQueries,
  };
}

// --- 以下2関数はprismaを引数で受け取る設計になっている ---
// recordSearchMiss等はモジュールレベルのprismaシングルトンを直接使用しているが、
// linkTaskToMiss/resolveSearchMissForTaskはタスク完了フロー（task-mutations.ts等）
// から呼ばれる想定のため、呼び出し元のprismaインスタンスを引数で受け取る。
// これにより task-mutations → search-miss-service → database の一方向依存が保たれ、
// 循環インポートを回避している。

/**
 * 検索ミスをタスクに紐付け、ステータスを 'suggested' に更新する。
 *
 * @param prisma - Prismaクライアント（呼び出し元から注入）
 * @param searchMissId - 紐付ける SearchMiss の ID
 * @param taskId - 提案するタスクの ID
 * @returns 更新完了時に解決される Promise
 */
export async function linkTaskToMiss(
  prisma: PrismaClient,
  searchMissId: number,
  taskId: number,
): Promise<void> {
  await prisma.searchMiss.update({
    where: { id: searchMissId },
    data: {
      status: 'suggested',
      suggestedTaskId: taskId,
    },
  });

  log.debug({ searchMissId, taskId }, 'Linked task to search miss');
}

/**
 * 指定タスクに紐付いた検索ミスを再検索し、結果が得られたものを 'resolved' に更新する。
 * 解決時に通知を作成する（best-effort: 通知失敗は更新をブロックしない）。
 *
 * @param prisma - Prismaクライアント（呼び出し元から注入）
 * @param taskId - 完了したタスクの ID
 * @returns 解決処理完了時に解決される Promise
 */
export async function resolveSearchMissForTask(
  prisma: PrismaClient,
  taskId: number,
): Promise<void> {
  const misses = await prisma.searchMiss.findMany({
    where: { suggestedTaskId: taskId, status: 'suggested' },
  });

  if (misses.length === 0) return;

  // `mode: 'insensitive'` は PostgreSQL 専用。SQLite（デスクトップ）生成クライアントの
  // StringFilter には `mode` が無く、送ると実行時に PrismaClientValidationError になる。
  // 稼働中プロバイダに応じて条件付きで付与する（routes/system/search/search-route.ts と
  // 同じ確立パターン）。SQLite では大文字小文字を区別する `contains` にフォールバックする。
  const isPostgres =
    process.env.RAPITAS_DB_PROVIDER !== 'sqlite' && !process.env.DATABASE_URL?.startsWith('file:');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `mode` は Postgres の StringFilter にのみ存在。any にすることで SQLite 生成クライアントでもこのスプレッドが型チェックを通る。
  const insensitive: any = isPostgres ? { mode: 'insensitive' } : {};

  for (const miss of misses) {
    const count = await prisma.task.count({
      where: {
        OR: [
          { title: { contains: miss.query, ...insensitive } },
          { description: { contains: miss.query, ...insensitive } },
        ],
      },
    });

    if (count === 0) continue;

    await prisma.searchMiss.update({
      where: { id: miss.id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedResultCount: count,
      },
    });

    log.debug({ searchMissId: miss.id, query: miss.query, count }, 'Resolved search miss');

    // Best-effort: 通知失敗は解決更新をブロックしない
    prisma.notification
      .create({
        data: {
          type: 'search_miss_resolved',
          title: '検索ミスが解決されました',
          message: `検索ミス「${miss.query}」が${count}件の結果で解決されました`,
          link: `/tasks/${taskId}`,
          metadata: JSON.stringify({ searchMissId: miss.id, query: miss.query, taskId }),
        },
      })
      .catch(() => {
        /* notification failure is non-fatal */
      });
  }
}
