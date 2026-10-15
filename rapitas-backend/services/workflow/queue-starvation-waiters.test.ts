/**
 * queue-starvation-waiters.test
 *
 * isDispatchableWaiter は「その待機項目をランナーが実際に発行しうるか」だけを
 * 判定する純関数。飢餓とは「発行できる仕事が待っているのに何も走っていない」
 * ことなので、ランナーが拒否する相手を数えると偽陽性になる(2026-09-27 に 7 回)。
 *
 * bun の mock.module はプロセス全体に効くため、このファイルは単独で実行する。
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

let queuedTaskIds: number[] = [];
let taskRows: Array<{
  id: number;
  status: string;
  workflowStatus: string | null;
  haltReason: string | null;
}> = [];
mock.module('../../config/database', () => ({
  prisma: {
    workflowQueueItem: {
      findMany: async () => queuedTaskIds.map((taskId) => ({ taskId })),
    },
    task: { findMany: async () => taskRows },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./auto-run/auto-run-selection', () => ({ hasLiveExecution: async () => false }));
let heldTaskIds = new Set<number>();
mock.module('./workflow-orchestrator-overlap-guard', () => ({
  isOverlapHeld: (taskId: number) => heldTaskIds.has(taskId),
}));

const { isDispatchableWaiter, resolveQueuedWaiters } = await import('./queue-starvation-waiters');

const base = { status: 'todo', workflowStatus: 'draft', haltReason: null };

beforeEach(() => {
  queuedTaskIds = [];
  taskRows = [];
  heldTaskIds = new Set<number>();
});

describe('isDispatchableWaiter', () => {
  test('発行対象: 通常の todo / in-progress', () => {
    expect(isDispatchableWaiter(base)).toBe(true);
    expect(
      isDispatchableWaiter({ ...base, status: 'in-progress', workflowStatus: 'in_progress' }),
    ).toBe(true);
  });

  test.each([
    ['halt 済み', { ...base, haltReason: 'budget_cost_exceeded' }],
    ['blocked', { ...base, status: 'blocked' }],
    ['質問待ち', { ...base, workflowStatus: 'awaiting_question' }],
    ['検証完了(マージ待ち)', { ...base, status: 'in-progress', workflowStatus: 'verify_done' }],
    ['done', { ...base, status: 'done' }],
    ['cancelled', { ...base, status: 'cancelled' }],
    ['completed', { ...base, workflowStatus: 'completed' }],
  ])('発行対象外: %s', (_label, task) => {
    expect(isDispatchableWaiter(task)).toBe(false);
  });
});

describe('resolveQueuedWaiters', () => {
  test('通常の待機項目は発行可能として数える', async () => {
    queuedTaskIds = [1111];
    taskRows = [{ id: 1111, ...base, status: 'in-progress', workflowStatus: 'plan_approved' }];
    expect(await resolveQueuedWaiters(1)).toEqual({ working: false, dispatchable: 1 });
  });

  // 2026-09-27 23:52 JST, task 1111: the overlap guard was deliberately holding
  // the implementer because its files were still open in PR #829, and the alert
  // still blamed the dispatcher (`runner_alive_not_dispatching`).
  test('重複保留中の項目は発行可能に数えない（1111 が PR #829 で保留中の事例）', async () => {
    queuedTaskIds = [1111];
    taskRows = [{ id: 1111, ...base, status: 'in-progress', workflowStatus: 'plan_approved' }];
    heldTaskIds = new Set([1111]);
    expect(await resolveQueuedWaiters(1)).toEqual({ working: false, dispatchable: 0 });
  });
});
