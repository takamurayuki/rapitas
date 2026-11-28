/**
 * auto-run-card-status — waiting for CI
 *
 * A task parked for its required merge must read 「CI 待ち」, never 次に着手 or
 * 順番待ち, whether or not the theme still holds a slot for it (task 1570).
 */
import { describe, expect, test } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { attachAutoRunCardStatus, type TaskLikeForAutoRunCardStatus } from './auto-run-card-status';

const devTheme = { isDevelopment: true, workingDirectory: 'C:/Projects/rapitas' };
const HOLD_CAUSE = 'verify_awaiting_required_merge';

interface Options {
  /** ThemeAutoRun rows of running themes; [] = paused or idle. */
  autoRuns?: Array<{ themeId: number; currentTaskId: number | null }>;
  cause?: string;
  halted?: boolean;
  failRead?: boolean;
}

function prismaWith(opts: Options = {}) {
  const queries: number[][] = [];
  const prisma = {
    themeAutoRun: { findMany: async () => opts.autoRuns ?? [] },
    workflowQueueItem: { findMany: async () => [] },
    userSettings: { findFirst: async () => ({ autoRunMaxConcurrency: 1 }) },
    task: {
      findMany: async ({ where }: { where: { id: { in: number[] } } }) => {
        queries.push(where.id.in);
        if (opts.failRead) throw new Error('db down');
        return opts.halted ? [] : where.id.in.map((id) => ({ id, theme: devTheme }));
      },
    },
    workflowTransition: { findFirst: async () => ({ cause: opts.cause ?? HOLD_CAUSE }) },
  } as unknown as PrismaClient;
  return { prisma, queries };
}

const parked = (
  over: Partial<TaskLikeForAutoRunCardStatus> = {},
): TaskLikeForAutoRunCardStatus => ({
  id: 5,
  themeId: 1,
  parentId: null,
  status: 'in-progress',
  workflowStatus: 'verify_done',
  theme: devTheme,
  ...over,
});

const running = [{ themeId: 1, currentTaskId: 5 }];

describe('a task parked for CI', () => {
  test('is marked after it gave the slot back', async () => {
    const { prisma } = prismaWith({ autoRuns: [{ themeId: 1, currentTaskId: 9 }] });
    const [task] = await attachAutoRunCardStatus(prisma, [parked()]);
    expect(task.autoRunAwaitingCi).toBe(true);
    expect(task.autoRunQueued).toBe(false);
  });

  test('is not 次に着手 while the theme still holds it as the current pick', async () => {
    const { prisma } = prismaWith({ autoRuns: running });
    const [task] = await attachAutoRunCardStatus(prisma, [parked()]);
    expect(task.autoRunAwaitingCi).toBe(true);
    expect(task.autoRunCurrent).toBe(false);
    expect(task.autoRunWaitingForSlot).toBe(false);
  });

  test('is marked when the theme is paused or idle', async () => {
    const { prisma } = prismaWith();
    const [task] = await attachAutoRunCardStatus(prisma, [parked()]);
    expect(task.autoRunAwaitingCi).toBe(true);
  });

  test('is marked as a nested subtask', async () => {
    const { prisma } = prismaWith();
    const [task] = await attachAutoRunCardStatus(prisma, [
      { id: 4, themeId: 1, parentId: null, status: 'todo', subtasks: [parked({ parentId: 4 })] },
    ]);
    expect(task.autoRunAwaitingCi).toBe(false);
    expect(task.subtasks?.[0].autoRunAwaitingCi).toBe(true);
  });

  test.each([
    ['the latest cause moved on to a repair', { cause: 'ci_repair' }],
    ['the task is halted', { halted: true }],
    ['the read fails', { failRead: true }],
  ])('is not marked when %s', async (_name, opts) => {
    const { prisma } = prismaWith({ ...opts, autoRuns: running });
    const [task] = await attachAutoRunCardStatus(prisma, [parked()]);
    expect(task.autoRunAwaitingCi).toBe(false);
    expect(task.autoRunCurrent).toBe(true);
  });

  test('is not marked outside an auto-run capable theme, and nothing is read', async () => {
    const { prisma, queries } = prismaWith();
    const [task] = await attachAutoRunCardStatus(prisma, [
      parked({ theme: { isDevelopment: false } }),
    ]);
    expect(task.autoRunAwaitingCi).toBe(false);
    expect(queries).toEqual([]);
  });

  test('clears a stale flag on a task that is no longer parked, without a query', async () => {
    const { prisma, queries } = prismaWith();
    const [task] = await attachAutoRunCardStatus(prisma, [
      parked({ status: 'done', workflowStatus: 'completed', autoRunAwaitingCi: true }),
    ]);
    expect(task.autoRunAwaitingCi).toBe(false);
    expect(queries).toEqual([]);
  });
});
