/**
 * Search Miss Service
 *
 * Records and aggregates zero-result search queries (SearchMiss) to surface
 * content gaps and support task-suggestion workflows.
 */

import type { PrismaClient, SearchMiss } from '@prisma/client';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { insensitiveContains } from '../../utils/database/db-helpers';

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
 * タスクタイトルにクエリが含まれる 'open' 状態の SearchMiss を自動リンクする。
 * searchMissId が指定されずにタスクを作成した場合のフォールバック処理。
 * タイトルにクエリが含まれるミスを 'suggested' に遷移させ、タスク完了時の
 * resolveSearchMissForTask が解決できるようにする。
 *
 * @param prisma - Prismaクライアント（呼び出し元から注入）
 * @param taskId - 作成されたタスクの ID
 * @param taskTitle - タスクタイトル（クエリマッチに使用）
 * @returns 自動リンク処理完了時に解決される Promise
 */
export async function autoLinkMatchingMisses(
  prisma: PrismaClient,
  taskId: number,
  taskTitle: string,
): Promise<void> {
  const titleLower = taskTitle.toLowerCase();
  const openMisses = await prisma.searchMiss.findMany({
    where: { status: 'open' },
    select: { id: true, query: true },
    take: 100,
  });

  const matched = openMisses.filter((m) => titleLower.includes(m.query.toLowerCase()));
  for (const miss of matched) {
    await linkTaskToMiss(prisma, miss.id, taskId);
  }

  if (matched.length > 0) {
    log.debug(
      { taskId, taskTitle, matchCount: matched.length },
      'Auto-linked matching search misses',
    );
  }
}

/**
 * 指定タスクに紐付いた検索ミス（status='suggested'）を再検索し、
 *  - 結果が得られたもの（count>0）→ 'resolved'（resolvedAt を記録）に更新し通知を作成
 *  - 結果が得られなかったもの（count===0）→ 'open' に戻す（resolvedAt は未設定のまま・
 *    suggestedTaskId をクリア）。提案タスクが完了しても穴が埋まっていないため未解決として扱う。
 * 通知作成は best-effort（失敗しても更新をブロックしない）。
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

  // Count matches for EVERY miss in parallel. Previously this awaited one
  // `task.count()` per miss inside the loop — an N+1 of 1+N sequential DB
  // round-trips. Results stay positionally aligned with `misses`.
  const counts = await Promise.all(
    misses.map((miss) =>
      prisma.task.count({
        where: {
          OR: [
            { title: insensitiveContains(miss.query) },
            { description: insensitiveContains(miss.query) },
          ],
        },
      }),
    ),
  );

  const evaluated = misses.map((miss, i) => ({ miss, count: counts[i] ?? 0 }));
  const toResolve = evaluated.filter(({ count }) => count > 0);
  // count === 0: the suggested task completed but the search STILL returns no
  // results, so the gap is NOT closed. Per the spec decision (answer A: "open に
  // 戻す"), return these misses to 'open' instead of leaving them stuck at
  // 'suggested'. resolvedAt deliberately stays null — the miss is unresolved, so
  // a missing timestamp here is CORRECT, not the bug. suggestedTaskId is cleared
  // so linkSearchMissesToTask can re-suggest the gap to a future task.
  const toReopen = evaluated.filter(({ count }) => count === 0);

  if (toResolve.length === 0 && toReopen.length === 0) return;

  // Single timestamp for the whole batch, and ONE transaction for all status
  // updates instead of N sequential round-trips. resolvedResultCount is still
  // stored exactly as before (kept for future analytics; nothing reads it yet).
  const now = new Date();
  await prisma.$transaction([
    ...toResolve.map(({ miss, count }) =>
      prisma.searchMiss.update({
        where: { id: miss.id },
        data: { status: 'resolved', resolvedAt: now, resolvedResultCount: count },
      }),
    ),
    ...toReopen.map(({ miss }) =>
      prisma.searchMiss.update({
        where: { id: miss.id },
        data: { status: 'open', suggestedTaskId: null },
      }),
    ),
  ]);

  // Best-effort notifications — fire-and-forget so a notification failure never
  // blocks the resolve (unchanged behaviour, just moved out of the count loop).
  for (const { miss, count } of toResolve) {
    log.debug({ searchMissId: miss.id, query: miss.query, count }, 'Resolved search miss');
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
      .catch((err: Error) => {
        log.error(
          { err, searchMissId: miss.id, query: miss.query, taskId },
          'Failed to create search-miss-resolved notification',
        );
      });
  }
}
