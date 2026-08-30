/**
 * queue-wait-exemption.test
 *
 * Fixtures mirror 2026-08-31: task 784 queued behind 785's long ci_repair,
 * force-stopped three times for "no progress" while merely waiting.
 * Run alone: bun's mock.module is process-global.
 */
import { describe, test, expect, mock } from 'bun:test';

let liveExecution = false;
mock.module('./auto-run-selection', () => ({
  hasLiveExecution: () => Promise.resolve(liveExecution),
}));

const { liveOrQueuedBehind } = await import('./queue-wait-exemption');

/** Queue rows keyed by (taskId match, status). */
function prismaWith(rows: Array<{ taskId: number; status: string }>) {
  return {
    workflowQueueItem: {
      findFirst: (args: { where: { taskId: number | { not: number }; status: string } }) => {
        const { taskId, status } = args.where;
        const hit = rows.find((r) =>
          typeof taskId === 'number'
            ? r.taskId === taskId && r.status === status
            : r.taskId !== taskId.not && r.status === status,
        );
        return Promise.resolve(hit ? { id: 1 } : null);
      },
    },
  };
}

describe('liveOrQueuedBehind', () => {
  test('自分が queued で他タスクが running なら「待機中」= true（#784 事例）', async () => {
    liveExecution = false;
    const prisma = prismaWith([
      { taskId: 784, status: 'queued' },
      { taskId: 785, status: 'running' },
    ]);
    expect(await liveOrQueuedBehind(prisma, 784)).toBe(true);
  });

  test('誰も running でなければ待機免除は付かない（本物のハングは止める）', async () => {
    liveExecution = false;
    const prisma = prismaWith([{ taskId: 784, status: 'queued' }]);
    expect(await liveOrQueuedBehind(prisma, 784)).toBe(false);
  });

  test('queued 項目が無ければ false', async () => {
    liveExecution = false;
    const prisma = prismaWith([{ taskId: 785, status: 'running' }]);
    expect(await liveOrQueuedBehind(prisma, 784)).toBe(false);
  });

  test('live heartbeat があれば queue を見ずに true', async () => {
    liveExecution = true;
    expect(await liveOrQueuedBehind(prismaWith([]), 784)).toBe(true);
  });

  test('照会失敗は fail open（false = 旧挙動維持）', async () => {
    liveExecution = false;
    const broken = {
      workflowQueueItem: {
        findFirst: () => Promise.reject(new Error('db down')),
      },
    };
    expect(await liveOrQueuedBehind(broken, 784)).toBe(false);
  });
});
