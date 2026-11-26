/**
 * auto-run-card-status — two tasks running in one theme (task 1552)
 *
 * With a per-theme limit of 2 the head (currentTaskId) and a companion
 * (companionTasksJson) both run. Both cards must show "current" and neither
 * may show "queued"; before the change only the head was current and the
 * companion showed 順番待ち although its agent was running.
 */
import { describe, test, expect } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { attachAutoRunCardStatus, type TaskLikeForAutoRunCardStatus } from './auto-run-card-status';

const devTheme = { isDevelopment: true, workingDirectory: 'C:/Projects/rapitas' };

function prismaWith(runningTaskIds: number[], limit: number, companions: string | null) {
  return {
    themeAutoRun: {
      findMany: async () => [{ themeId: 1, currentTaskId: 5, companionTasksJson: companions }],
    },
    workflowQueueItem: { findMany: async () => runningTaskIds.map((taskId) => ({ taskId })) },
    userSettings: { findFirst: async () => ({ autoRunMaxConcurrency: limit }) },
  } as unknown as PrismaClient;
}

const cards = (): TaskLikeForAutoRunCardStatus[] => [
  { id: 5, themeId: 1, parentId: null, status: 'in-progress', theme: devTheme },
  { id: 6, themeId: 1, parentId: null, status: 'todo', theme: devTheme },
  { id: 7, themeId: 1, parentId: null, status: 'todo', theme: devTheme },
];

describe('attachAutoRunCardStatus with companions', () => {
  test('head and companion are both current; the third task is queued', async () => {
    const [head, companion, other] = await attachAutoRunCardStatus(
      prismaWith([5, 6], 2, '[{"taskId":6,"since":1}]'),
      cards(),
    );
    expect(head.autoRunCurrent).toBe(true);
    expect(companion.autoRunCurrent).toBe(true);
    expect(companion.autoRunQueued).toBe(false);
    expect(other.autoRunCurrent).toBe(false);
    expect(other.autoRunQueued).toBe(true);
  });

  test('a companion whose agent has not started waits for the slot when others fill it', async () => {
    const [, companion] = await attachAutoRunCardStatus(
      prismaWith([5, 9], 2, '[{"taskId":6,"since":1}]'),
      cards(),
    );
    expect(companion.autoRunCurrent).toBe(true);
    expect(companion.autoRunWaitingForSlot).toBe(true);
  });

  test('malformed companion JSON → only the head is current (safe fallback)', async () => {
    const [head, companion] = await attachAutoRunCardStatus(
      prismaWith([5], 2, 'not-json'),
      cards(),
    );
    expect(head.autoRunCurrent).toBe(true);
    expect(companion.autoRunCurrent).toBe(false);
  });
});
