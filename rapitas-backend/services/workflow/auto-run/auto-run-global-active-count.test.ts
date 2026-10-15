/**
 * auto-run-global-active-count.test.ts
 *
 * Verifies that items of non-progressing themes do not hold the global auto-run slot.
 * Uses a small in-memory fake of the two Prisma delegates involved.
 */
import { describe, it, expect } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { getGlobalAutoRunActiveCount } from './auto-run-global-active-count';
import { selectNextTask } from './auto-run-selection';

type Item = { themeId: number | null; status: string };
type Run = { themeId: number; status: string };

type Clause = { status?: string | { in: string[] }; themeId?: { notIn: number[] } };

function fakePrisma(items: Item[], runs: Run[]): PrismaClient {
  const matches = (i: Item, c: Clause) => {
    const s = c.status;
    const okStatus =
      s === undefined || (typeof s === 'string' ? i.status === s : s.in.includes(i.status));
    return okStatus && (!c.themeId || !c.themeId.notIn.includes(i.themeId as number));
  };
  return {
    themeAutoRun: {
      findMany: async () => runs.filter((r) => r.status !== 'running'),
    },
    workflowQueueItem: {
      count: async ({ where }: { where: { themeId: { not: null }; OR: Clause[] } }) =>
        items.filter((i) => i.themeId !== null && where.OR.some((c) => matches(i, c))).length,
    },
    userSettings: { findFirst: async () => ({ workflowDisabledGlobally: false }) },
    task: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

describe('getGlobalAutoRunActiveCount', () => {
  it.each(['paused', 'paused_user', 'paused_approval', 'idle', 'stopping'])(
    'AC1: %s テーマの queued item のみなら 0 件',
    async (status) => {
      const prisma = fakePrisma([{ themeId: 35, status: 'queued' }], [{ themeId: 35, status }]);
      expect(await getGlobalAutoRunActiveCount(prisma)).toBe(0);
    },
  );

  it('AC2: running テーマの queued item は 1 件として数える', async () => {
    const prisma = fakePrisma(
      [{ themeId: 1, status: 'queued' }],
      [{ themeId: 1, status: 'running' }],
    );
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(1);
  });

  it('paused テーマの running / waiting_approval item は数え続ける', async () => {
    const prisma = fakePrisma(
      [
        { themeId: 35, status: 'running' },
        { themeId: 35, status: 'waiting_approval' },
      ],
      [{ themeId: 35, status: 'paused_user' }],
    );
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(2);
  });

  it('ThemeAutoRun 行が無いテーマの queued item は従来どおり数える', async () => {
    const prisma = fakePrisma([{ themeId: 9, status: 'queued' }], []);
    expect(await getGlobalAutoRunActiveCount(prisma)).toBe(1);
  });

  it('AC3: paused テーマの item だけでは他テーマの selectNextTask が concurrency_limit にならない', async () => {
    const prisma = fakePrisma(
      [{ themeId: 35, status: 'queued' }],
      [{ themeId: 35, status: 'paused_user' }],
    );
    const active = await getGlobalAutoRunActiveCount(prisma);
    const result = await selectNextTask(prisma, 1, 'priority', [], active);
    expect(result).toEqual({ found: false, reason: 'all_done' });
  });
});
