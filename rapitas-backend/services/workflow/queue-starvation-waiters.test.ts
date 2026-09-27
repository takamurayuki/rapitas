/**
 * queue-starvation-waiters.test
 *
 * isDispatchableWaiter は「その待機項目をランナーが実際に発行しうるか」だけを
 * 判定する純関数。飢餓とは「発行できる仕事が待っているのに何も走っていない」
 * ことなので、ランナーが拒否する相手を数えると偽陽性になる(2026-09-27 に 7 回)。
 */
import { describe, expect, test, mock } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { isDispatchableWaiter } = await import('./queue-starvation-waiters');

const base = { status: 'todo', workflowStatus: 'draft', haltReason: null };

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
