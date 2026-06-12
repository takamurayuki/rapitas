/**
 * Search Miss Service テスト
 *
 * resolveSearchMissForTask の解決ロジック・provider 分岐・
 * 通知失敗時の log.error 出力（fire-and-forget エラーハンドリング）を検証する。
 */
import { describe, test, expect, mock, afterEach } from 'bun:test';
import type { PrismaClient } from '@prisma/client';

// Stable logger mock instances — module-scope so call-count assertions work across tests.
// NOTE: createLogger must return the SAME object every call; otherwise the ref captured by
// the service module at import time diverges from the ref we assert against here.
const infoMock = mock(() => {});
const debugMock = mock(() => {});
const warnMock = mock(() => {});
const errorMock = mock(() => {});

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: infoMock, debug: debugMock, warn: warnMock, error: errorMock }),
}));
// recordSearchMiss / getTopMissedQueries / getRelatedMisses use the module-level
// prisma singleton; mock it with a searchMiss.findMany we can assert against.
const relatedFindMany = mock((_args: unknown) => Promise.resolve([] as unknown[]));
mock.module('../../config/database', () => ({
  prisma: { searchMiss: { findMany: relatedFindMany } },
}));

const { resolveSearchMissForTask, getRelatedMisses } =
  await import('../../services/search/search-miss-service');

// ---- Fixtures ----

const MISS_A = {
  id: 1,
  query: 'typescript',
  suggestedTaskId: 10,
  status: 'suggested',
  hitCount: 3,
  lastSearchedAt: new Date(),
  resolvedAt: null,
  resolvedResultCount: null,
};

const MISS_B = {
  id: 2,
  query: 'react hooks',
  suggestedTaskId: 10,
  status: 'suggested',
  hitCount: 1,
  lastSearchedAt: new Date(),
  resolvedAt: null,
  resolvedResultCount: null,
};

// ---- Helpers ----

function usePostgresEnv() {
  delete process.env.RAPITAS_DB_PROVIDER;
  delete process.env.DATABASE_URL;
}

function useSQLiteEnv() {
  process.env.RAPITAS_DB_PROVIDER = 'sqlite';
  delete process.env.DATABASE_URL;
}

function useSQLiteUrlEnv() {
  delete process.env.RAPITAS_DB_PROVIDER;
  process.env.DATABASE_URL = 'file:./dev.db';
}

type Fixture = typeof MISS_A;

type MockPrismaOptions = {
  misses?: Fixture[];
  counts?: number | number[];
  notificationReject?: boolean;
};

/**
 * Creates a minimal Prisma mock wired for resolveSearchMissForTask.
 *
 * @param opts.misses - SearchMiss rows returned by findMany / findMany が返す行
 * @param opts.counts - task.count responses (scalar = same for all; array = per-miss) / task.count 応答
 * @param opts.notificationReject - notification.create を reject させる場合 true
 * @returns prisma mock and individual mock handles for assertions
 */
function makeMockPrisma({
  misses = [],
  counts = 0,
  notificationReject = false,
}: MockPrismaOptions) {
  const countValues = Array.isArray(counts) ? counts : misses.map(() => counts as number);
  let callIdx = 0;

  const findManyMock = mock(() => Promise.resolve(misses));
  const updateMock = mock(() => Promise.resolve({}));
  // NOTE: callIdx increments per call so Promise.all gets distinct values per miss.
  const countMock = mock(() => Promise.resolve(countValues[callIdx++] ?? 0));
  const txMock = mock((ops: unknown[]) => Promise.resolve(ops.map(() => ({}))));
  const notifCreateMock = notificationReject
    ? mock(() => Promise.reject(new Error('DB connection failed')))
    : mock(() => Promise.resolve({ id: 99 }));

  const prisma = {
    searchMiss: { findMany: findManyMock, update: updateMock },
    task: { count: countMock },
    $transaction: txMock,
    notification: { create: notifCreateMock },
  } as unknown as PrismaClient;

  return { prisma, findManyMock, countMock, txMock, notifCreateMock, updateMock };
}

// ---- Test Suite ----

describe('resolveSearchMissForTask', () => {
  afterEach(() => {
    infoMock.mockClear();
    debugMock.mockClear();
    warnMock.mockClear();
    errorMock.mockClear();
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
  });

  test('misses が空のとき早期 return し task.count と $transaction を呼ばない', async () => {
    const { prisma, countMock, txMock } = makeMockPrisma({ misses: [] });
    usePostgresEnv();

    await resolveSearchMissForTask(prisma, 10);

    expect(countMock).not.toHaveBeenCalled();
    expect(txMock).not.toHaveBeenCalled();
  });

  test('すべての count が 0 のとき全 miss を open に戻す（resolvedAt は設定しない）', async () => {
    // 回答A: 提案タスク完了後も結果0なら未解決 → 'open' に戻す。
    const { prisma, txMock, updateMock, notifCreateMock } = makeMockPrisma({
      misses: [MISS_A, MISS_B],
      counts: 0,
    });
    usePostgresEnv();

    await resolveSearchMissForTask(prisma, 10);

    // 全 miss を $transaction で open へ更新する。
    expect(txMock).toHaveBeenCalledTimes(1);
    const [ops] = txMock.mock.calls[0] as [unknown[]];
    expect(ops).toHaveLength(2);
    // 各 update は status:'open' / suggestedTaskId:null、resolvedAt は付与しない。
    for (const call of updateMock.mock.calls) {
      const arg = call[0] as { data: Record<string, unknown> };
      expect(arg.data.status).toBe('open');
      expect(arg.data.suggestedTaskId).toBeNull();
      expect('resolvedAt' in arg.data).toBe(false);
    }
    // 再オープンはユーザー向けイベントではないため通知しない。
    expect(notifCreateMock).not.toHaveBeenCalled();
  });

  test('count > 0 の miss を $transaction で一括 resolved に更新する', async () => {
    const { prisma, txMock } = makeMockPrisma({ misses: [MISS_A], counts: 2 });
    usePostgresEnv();

    await resolveSearchMissForTask(prisma, 10);

    expect(txMock).toHaveBeenCalledTimes(1);
    const [ops] = txMock.mock.calls[0] as [unknown[]];
    expect(ops).toHaveLength(1);
  });

  test('count が混在するとき count>0 は resolved・count=0 は open で同一 $transaction に含める', async () => {
    // MISS_A=2 → resolved, MISS_B=0 → open。両方が1つの $transaction に入る。
    const { prisma, txMock, updateMock } = makeMockPrisma({
      misses: [MISS_A, MISS_B],
      counts: [2, 0],
    });
    usePostgresEnv();

    await resolveSearchMissForTask(prisma, 10);

    expect(txMock).toHaveBeenCalledTimes(1);
    const [ops] = txMock.mock.calls[0] as [unknown[]];
    expect(ops).toHaveLength(2);
    const datas = updateMock.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    // MISS_A (id:1) は resolved + resolvedAt 付与。
    const resolved = datas.find((d) => d.status === 'resolved');
    expect(resolved).toBeDefined();
    expect(resolved!.resolvedAt).toBeInstanceOf(Date);
    // MISS_B (id:2) は open + resolvedAt 未設定。
    const reopened = datas.find((d) => d.status === 'open');
    expect(reopened).toBeDefined();
    expect('resolvedAt' in reopened!).toBe(false);
    expect(reopened!.suggestedTaskId).toBeNull();
  });

  test('Postgres 環境では task.count の where 条件に mode:"insensitive" が含まれる', async () => {
    const { prisma, countMock } = makeMockPrisma({ misses: [MISS_A], counts: 1 });
    usePostgresEnv();

    await resolveSearchMissForTask(prisma, 10);

    const [arg] = countMock.mock.calls[0] as [{ where: unknown }][];
    expect(JSON.stringify(arg)).toContain('insensitive');
  });

  test('RAPITAS_DB_PROVIDER=sqlite のとき task.count の where に mode が含まれない', async () => {
    const { prisma, countMock } = makeMockPrisma({ misses: [MISS_A], counts: 1 });
    useSQLiteEnv();

    await resolveSearchMissForTask(prisma, 10);

    const [arg] = countMock.mock.calls[0] as [{ where: unknown }][];
    expect(JSON.stringify(arg)).not.toContain('insensitive');
  });

  test('DATABASE_URL が file: で始まるとき SQLite と判定し mode を付与しない', async () => {
    const { prisma, countMock } = makeMockPrisma({ misses: [MISS_A], counts: 1 });
    useSQLiteUrlEnv();

    await resolveSearchMissForTask(prisma, 10);

    const [arg] = countMock.mock.calls[0] as [{ where: unknown }][];
    expect(JSON.stringify(arg)).not.toContain('insensitive');
  });

  test('通知 create が reject しても関数は例外を投げない', async () => {
    const { prisma } = makeMockPrisma({ misses: [MISS_A], counts: 2, notificationReject: true });
    usePostgresEnv();

    await expect(resolveSearchMissForTask(prisma, 10)).resolves.toBeUndefined();
  });

  test('通知 create が reject したとき log.error が err+コンテキスト付きで呼ばれる', async () => {
    const { prisma } = makeMockPrisma({ misses: [MISS_A], counts: 2, notificationReject: true });
    usePostgresEnv();

    await resolveSearchMissForTask(prisma, 10);
    // NOTE: notification.create is fire-and-forget (not awaited), so .catch runs in the
    // next microtask turn — flush the queue before asserting.
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(errorMock).toHaveBeenCalledTimes(1);
    const [ctx, msg] = errorMock.mock.calls[0] as [
      { err: Error; searchMissId: number; query: string; taskId: number },
      string,
    ];
    expect(ctx.err).toBeInstanceOf(Error);
    expect(ctx.searchMissId).toBe(MISS_A.id);
    expect(ctx.query).toBe(MISS_A.query);
    expect(ctx.taskId).toBe(10);
    expect(msg).toContain('notification');
  });
});

describe('getRelatedMisses', () => {
  afterEach(() => {
    relatedFindMany.mockClear();
  });

  test('語が3文字未満/空のみのときは findMany を呼ばず [] を返す', async () => {
    const res = await getRelatedMisses(['ab', '  ', 'x'], 5);
    expect(res).toEqual([]);
    expect(relatedFindMany).not.toHaveBeenCalled();
  });

  test('有効な語を小文字化・重複排除し status:open + OR contains で問い合わせる', async () => {
    await getRelatedMisses(['Dashboard', 'dashboard', 'API'], 7);

    expect(relatedFindMany).toHaveBeenCalledTimes(1);
    const [arg] = relatedFindMany.mock.calls[0] as [
      {
        where: { status: string; OR: Array<{ query: { contains: string } }> };
        take: number;
        orderBy: { hitCount: string };
      },
    ];
    expect(arg.where.status).toBe('open');
    const terms = arg.where.OR.map((o) => o.query.contains);
    expect(terms).toContain('dashboard');
    expect(terms).toContain('api');
    // 'Dashboard' と 'dashboard' は同一語として 1 件に重複排除される。
    expect(terms.filter((t) => t === 'dashboard')).toHaveLength(1);
    expect(arg.take).toBe(7);
    expect(arg.orderBy.hitCount).toBe('desc');
  });
});
