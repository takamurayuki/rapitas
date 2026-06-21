/**
 * outcome-reinforcement.test
 *
 * Verifies the retrieval→outcome trace bookkeeping: entries used by a task are
 * counted once, merged across multiple retrievals, and the trace is cleared
 * after the outcome is applied. The decay primitives (boost/penalize) are no-ops
 * here for non-existent ids — forgetting.ts returns early when the entry is not
 * found — so no module mock (which would leak process-globally) is needed.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { recordRetrieval, applyOutcomeReinforcement, _resetTraces } from './outcome-reinforcement';

describe('outcome-reinforcement', () => {
  beforeEach(() => {
    _resetTraces();
  });

  test('success applies to every retrieved entry once', async () => {
    recordRetrieval(1, [10, 11, 12]);
    expect(await applyOutcomeReinforcement(1, true)).toBe(3);
  });

  test('failure applies to every retrieved entry', async () => {
    recordRetrieval(2, [20, 21]);
    expect(await applyOutcomeReinforcement(2, false)).toBe(2);
  });

  test('merges entries across multiple retrievals and de-dups ids', async () => {
    recordRetrieval(3, [30, 31]);
    recordRetrieval(3, [31, 32]); // 31 repeated within the same task run
    expect(await applyOutcomeReinforcement(3, true)).toBe(3); // 30,31,32
  });

  test('clears the trace after applying — a second outcome is a no-op', async () => {
    recordRetrieval(4, [40]);
    expect(await applyOutcomeReinforcement(4, true)).toBe(1);
    expect(await applyOutcomeReinforcement(4, true)).toBe(0);
  });

  test('no trace → no-op (best-effort after a restart drops the trace)', async () => {
    expect(await applyOutcomeReinforcement(999, true)).toBe(0);
  });

  test('ignores empty retrievals and non-integer task ids', async () => {
    recordRetrieval(5, []);
    recordRetrieval(Number.NaN, [50]);
    expect(await applyOutcomeReinforcement(5, true)).toBe(0);
  });
});
