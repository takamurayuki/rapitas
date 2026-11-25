/**
 * auto-run-card-status — waiting for the global slot
 *
 * 2026-11-25: 「次に着手で待機時間が発生する原因はなぜですか」. The theme's
 * current pick showed 次に着手 for 30〜65 minutes while ANOTHER task's agent
 * held the only global slot (autoRunMaxConcurrency=1) — it looked stuck, but
 * it was simply waiting its turn. The card now says so.
 */
import { describe, test, expect } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { attachAutoRunCardStatus, type TaskLikeForAutoRunCardStatus } from './auto-run-card-status';

const devTheme = { isDevelopment: true, workingDirectory: 'C:/Projects/rapitas' };

function prismaWith(opts: { runningTaskIds: number[]; limit: number }): PrismaClient {
  return {
    themeAutoRun: { findMany: async () => [{ themeId: 1, currentTaskId: 5 }] },
    workflowQueueItem: {
      findMany: async () => opts.runningTaskIds.map((taskId) => ({ taskId })),
    },
    userSettings: { findFirst: async () => ({ autoRunMaxConcurrency: opts.limit }) },
  } as unknown as PrismaClient;
}

const current = (): TaskLikeForAutoRunCardStatus[] => [
  { id: 5, themeId: 1, parentId: null, status: 'in-progress', theme: devTheme },
];

describe('the current pick while another task holds the slot', () => {
  test('is marked as waiting for the slot when other tasks fill every slot', async () => {
    const [task] = await attachAutoRunCardStatus(
      prismaWith({ runningTaskIds: [9], limit: 1 }),
      current(),
    );
    expect(task.autoRunCurrent).toBe(true);
    expect(task.autoRunWaitingForSlot).toBe(true);
  });

  test('is not waiting when its own item is the one running', async () => {
    const [task] = await attachAutoRunCardStatus(
      prismaWith({ runningTaskIds: [5], limit: 1 }),
      current(),
    );
    expect(task.autoRunWaitingForSlot).toBe(false);
  });

  test('is not waiting while a slot is still free', async () => {
    const [task] = await attachAutoRunCardStatus(
      prismaWith({ runningTaskIds: [9], limit: 2 }),
      current(),
    );
    expect(task.autoRunWaitingForSlot).toBe(false);
  });

  test('falls back to not waiting when the slot lookup fails', async () => {
    const prisma = {
      themeAutoRun: { findMany: async () => [{ themeId: 1, currentTaskId: 5 }] },
      workflowQueueItem: {
        findMany: async () => {
          throw new Error('db down');
        },
      },
    } as unknown as PrismaClient;
    const [task] = await attachAutoRunCardStatus(prisma, current());
    expect(task.autoRunCurrent).toBe(true);
    expect(task.autoRunWaitingForSlot).toBe(false);
  });
});
