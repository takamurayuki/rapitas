/**
 * auto-run-concurrency.test.ts
 *
 * Unit tests for the auto-run concurrency limit resolver, the theme priority
 * helpers and the in-memory "waiting for a slot" ledger (task 1543).
 * Uses an in-memory Prisma mock — no live DB.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';
import {
  CONCURRENCY_WAITER_TTL_MS,
  normalizeAutoRunMaxConcurrency,
  normalizeThemeAutoRunPriority,
  parseEnvAutoRunMaxConcurrency,
  resolveAutoRunMaxConcurrency,
  loadThemeAutoRunPriorities,
  sortRunningThemesByPriority,
  noteConcurrencyWaiter,
  clearConcurrencyWaiter,
  shouldYieldToHigherPriorityTheme,
  __resetConcurrencyWaitersForTests,
} from './auto-run-concurrency';

function prismaWith(opts: {
  settings?: unknown;
  settingsThrows?: boolean;
  priorities?: Record<number, number>;
  themeThrows?: boolean;
  taskCount?: number;
}): PrismaClient {
  return {
    userSettings: {
      findFirst: mock(async () => {
        if (opts.settingsThrows) throw new Error('db down');
        return opts.settings ?? null;
      }),
    },
    theme: {
      findMany: mock(async (args: { where: { id: { in: number[] } } }) => {
        if (opts.themeThrows) throw new Error('unknown column');
        return args.where.id.in.map((id) => ({ id, autoRunPriority: opts.priorities?.[id] ?? 0 }));
      }),
    },
    task: { count: mock(async () => opts.taskCount ?? 1) },
  } as unknown as PrismaClient;
}

describe('normalizeAutoRunMaxConcurrency', () => {
  it.each([
    [0, 1],
    [5, 4],
    ['x', 1],
    [undefined, 1],
    [null, 1],
    [Number.NaN, 1],
    [2.7, 2],
    [1, 1],
    [4, 4],
  ])('%p → %p', (input, expected) => {
    expect(normalizeAutoRunMaxConcurrency(input)).toBe(expected);
  });
});

describe('parseEnvAutoRunMaxConcurrency', () => {
  it.each([
    [{ AUTO_RUN_GLOBAL_MAX_CONCURRENCY: '3' }, 3],
    [{ AUTO_RUN_GLOBAL_MAX_CONCURRENCY: '6' }, 6],
    [{ AUTO_RUN_GLOBAL_MAX_CONCURRENCY: 'abc' }, null],
    [{ AUTO_RUN_GLOBAL_MAX_CONCURRENCY: '' }, null],
    [{ AUTO_RUN_GLOBAL_MAX_CONCURRENCY: '0' }, null],
    [{ AUTO_RUN_GLOBAL_MAX_CONCURRENCY: '-2' }, null],
    [{}, null],
  ])('%p → %p', (env, expected) => {
    expect(parseEnvAutoRunMaxConcurrency(env)).toBe(expected);
  });
});

describe('resolveAutoRunMaxConcurrency', () => {
  it('env が設定されていれば設定値より env を優先する', async () => {
    const prisma = prismaWith({ settings: { autoRunMaxConcurrency: 2 } });
    const resolved = await resolveAutoRunMaxConcurrency(prisma, {
      AUTO_RUN_GLOBAL_MAX_CONCURRENCY: '3',
    });
    expect(resolved).toEqual({ limit: 3, source: 'env' });
  });

  it.each(['abc', '', '0'])('env が不正値 %p なら設定値 2 に落ちる', async (raw) => {
    const prisma = prismaWith({ settings: { autoRunMaxConcurrency: 2 } });
    const resolved = await resolveAutoRunMaxConcurrency(prisma, {
      AUTO_RUN_GLOBAL_MAX_CONCURRENCY: raw,
    });
    expect(resolved).toEqual({ limit: 2, source: 'settings' });
  });

  it.each([
    [0, 1],
    [5, 4],
    ['x', 1],
    [undefined, 1],
  ])('設定値 %p は %p に丸める', async (value, expected) => {
    const prisma = prismaWith({ settings: { autoRunMaxConcurrency: value } });
    expect(await resolveAutoRunMaxConcurrency(prisma, {})).toEqual({
      limit: expected,
      source: 'settings',
    });
  });

  it('設定行がない・読み取りが失敗したときは 1', async () => {
    expect(await resolveAutoRunMaxConcurrency(prismaWith({}), {})).toEqual({
      limit: 1,
      source: 'settings',
    });
    expect(await resolveAutoRunMaxConcurrency(prismaWith({ settingsThrows: true }), {})).toEqual({
      limit: 1,
      source: 'settings',
    });
  });

  it('モックに userSettings がなくても 1 に落ちる', async () => {
    const prisma = {} as unknown as PrismaClient;
    expect(await resolveAutoRunMaxConcurrency(prisma, {})).toEqual({
      limit: 1,
      source: 'settings',
    });
  });
});

describe('normalizeThemeAutoRunPriority', () => {
  it.each([
    [250, 100],
    [-250, -100],
    [Number.NaN, 0],
    ['5', 0],
    [undefined, 0],
    [7.9, 7],
    [-3, -3],
  ])('%p → %p', (input, expected) => {
    expect(normalizeThemeAutoRunPriority(input)).toBe(expected);
  });
});

describe('loadThemeAutoRunPriorities / sortRunningThemesByPriority', () => {
  it('優先度を読み、例外なら空の Map を返す', async () => {
    const map = await loadThemeAutoRunPriorities(prismaWith({ priorities: { 35: 10 } }), [1, 35]);
    expect(map.get(35)).toBe(10);
    expect(map.get(1)).toBe(0);
    const empty = await loadThemeAutoRunPriorities(prismaWith({ themeThrows: true }), [1, 35]);
    expect(empty.size).toBe(0);
  });

  it('id が空なら DB を読まない', async () => {
    const prisma = prismaWith({});
    const map = await loadThemeAutoRunPriorities(prisma, []);
    expect(map.size).toBe(0);
    expect(prisma.theme.findMany).not.toHaveBeenCalled();
  });

  it('優先度の降順、同じなら themeId の昇順。元の配列は変えない', () => {
    const states = [{ themeId: 35 }, { themeId: 1 }, { themeId: 7 }];
    const sorted = sortRunningThemesByPriority(states, new Map([[7, 5]]));
    expect(sorted.map((s) => s.themeId)).toEqual([7, 1, 35]);
    expect(states.map((s) => s.themeId)).toEqual([35, 1, 7]);
  });
});

describe('concurrency waiter ledger', () => {
  beforeEach(() => __resetConcurrencyWaitersForTests());

  it('高優先テーマが登録されていれば、低優先テーマは譲る', async () => {
    const prisma = prismaWith({ priorities: { 35: 10, 1: 0 } });
    await noteConcurrencyWaiter(prisma, 35, 1_000);
    expect(await shouldYieldToHigherPriorityTheme(prisma, 1, 2_000)).toEqual({
      yield: true,
      to: 35,
    });
  });

  it('記録は有効期間を過ぎると失効する', async () => {
    const prisma = prismaWith({ priorities: { 35: 10, 1: 0 } });
    await noteConcurrencyWaiter(prisma, 35, 1_000);
    expect(CONCURRENCY_WAITER_TTL_MS).toBe(30_000);
    expect(await shouldYieldToHigherPriorityTheme(prisma, 1, 1_000 + 31_000)).toEqual({
      yield: false,
    });
  });

  it('同じ優先度なら譲らない', async () => {
    const prisma = prismaWith({ priorities: { 35: 0, 1: 0 } });
    await noteConcurrencyWaiter(prisma, 35, 1_000);
    expect(await shouldYieldToHigherPriorityTheme(prisma, 1, 2_000)).toEqual({ yield: false });
  });

  it('選定できるタスクが 0 件のテーマは登録しない', async () => {
    const prisma = prismaWith({ priorities: { 35: 10, 1: 0 }, taskCount: 0 });
    await noteConcurrencyWaiter(prisma, 35, 1_000);
    expect(await shouldYieldToHigherPriorityTheme(prisma, 1, 2_000)).toEqual({ yield: false });
  });

  it('自分の記録だけなら DB を読まずに譲らない。clear で記録が消える', async () => {
    const prisma = prismaWith({ priorities: { 35: 10, 1: 0 } });
    await noteConcurrencyWaiter(prisma, 35, 1_000);
    const callsAfterNote = (prisma.theme.findMany as ReturnType<typeof mock>).mock.calls.length;
    expect(await shouldYieldToHigherPriorityTheme(prisma, 35, 2_000)).toEqual({ yield: false });
    expect((prisma.theme.findMany as ReturnType<typeof mock>).mock.calls.length).toBe(
      callsAfterNote,
    );
    clearConcurrencyWaiter(35);
    expect(await shouldYieldToHigherPriorityTheme(prisma, 1, 2_000)).toEqual({ yield: false });
  });

  it('優先度の読み取りが失敗したら全テーマ 0 として扱い、譲らない', async () => {
    const prisma = prismaWith({ themeThrows: true });
    await noteConcurrencyWaiter(prisma, 35, 1_000);
    expect(await shouldYieldToHigherPriorityTheme(prisma, 1, 2_000)).toEqual({ yield: false });
  });
});
