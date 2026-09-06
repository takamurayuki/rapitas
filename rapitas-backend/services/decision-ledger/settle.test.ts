/**
 * decision-ledger/settle.test
 *
 * Covers the single settlement point. The rule under test is that settling a
 * task never becomes a way for the ledger to fail the task's own outcome, and
 * that it settles ONLY that task.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const runConsistencyCheckBatch = mock(() => Promise.resolve({ checked: 3, updated: 2 }));
mock.module('../observability/decision-trace', () => ({ runConsistencyCheckBatch }));

// NOTE (task 865): settle.ts now Promise.all's THREE settlement systems
// (execution/filings/recalls) — without mocking the other two, their real
// implementations reach a real, unreachable DB and reject, which used to
// throw settleDecisions() straight into its catch (returning {checked:0,
// settled:0} for every case, 1 fail). Both stubbed to {checked:0, settled:0}
// so the totals reduce to exactly runConsistencyCheckBatch's contribution,
// matching this suite's existing expectations. Full export mirror required
// by mock.module.
const settleFilingDecisions = mock(() => Promise.resolve({ checked: 0, settled: 0 }));
mock.module('./settle-filing', () => ({
  judgeFiling: mock(() => null),
  settleFilingDecisions,
}));
const settleKnowledgeDecisions = mock(() => Promise.resolve({ checked: 0, settled: 0 }));
mock.module('./settle-knowledge', () => ({
  judgeRecall: mock(() => null),
  ENTRY_USAGE_ACTION: 'knowledge_entry_usage',
  settleKnowledgeDecisions,
}));

const { settleDecisions } = await import('./settle');

describe('settleDecisions', () => {
  beforeEach(() =>
    runConsistencyCheckBatch.mockReset().mockResolvedValue({ checked: 3, updated: 2 }),
  );

  test('settles only the task that ended', async () => {
    expect(await settleDecisions(666)).toEqual({ checked: 3, settled: 2 });
    expect(runConsistencyCheckBatch.mock.calls[0]?.[0]).toEqual({ taskId: 666 } as never);
  });

  test('a settlement failure never reaches the task outcome', async () => {
    runConsistencyCheckBatch.mockRejectedValue(new Error('db down'));
    expect(await settleDecisions(666)).toEqual({ checked: 0, settled: 0 });
  });

  test('a nonsense task id settles nothing rather than sweeping everything', async () => {
    expect(await settleDecisions(Number.NaN)).toEqual({ checked: 0, settled: 0 });
    expect(runConsistencyCheckBatch).not.toHaveBeenCalled();
  });
});
