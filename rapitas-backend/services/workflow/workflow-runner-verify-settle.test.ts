/**
 * workflow-runner-verify-settle.test
 *
 * Task 772: a fresh verify-phase rejection (adversarial-review FAIL, bounce,
 * non-convergence cutoff, failed PR creation) must veto the landed-artifact
 * force-completion inside waitForVerifyCompletion — a PR merely existing on
 * record must not overrule a jury verdict recorded moments earlier (task 755:
 * jury FAIL immediately followed by settle force-completing from PR #537).
 * Exercises the guard from both call sites: the task-not-found branch and the
 * grace-window-exceeded branch.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { TaskWorkflowState } from '../task/task-resolver';
import { getEventListeners } from 'node:events';

process.env.RAPITAS_VERIFY_SETTLE_MS = '50';
process.env.RAPITAS_VERIFY_SETTLE_CAP_MS = '50';

let resolveWorkflowStateSequence: (TaskWorkflowState | null)[] = [];
let resolveWorkflowStateCallIndex = 0;
const resolveTaskWorkflowStateMock = mock((): Promise<TaskWorkflowState | null> => {
  const idx = Math.min(resolveWorkflowStateCallIndex, resolveWorkflowStateSequence.length - 1);
  resolveWorkflowStateCallIndex++;
  return Promise.resolve(idx >= 0 ? resolveWorkflowStateSequence[idx] : null);
});

// The settle wait also asks whether the verifier is still running (task 1547);
// these cases have no live verifier, and the real lookup would reach the DB.
// Task 1568: the settle wait may ask whether the scheduler handed the item back.
const handedBackMock = mock(async (_itemId: number) => false);
let awaitingCi = false;
// 'ci' = the task/transition read fails; 'ownership' = the item lookup itself throws.
let lookupFails: 'ci' | 'ownership' | null = null;
mock.module('./awaiting-ci-lookup', () => ({
  isQueueItemHandedBack: handedBackMock,
  // Ownership is the negation of "handed back" in these cases (a missing row would be false too).
  isItemStillOwned: async (itemId: number) => {
    if (lookupFails === 'ownership') throw new Error('lookup unavailable');
    return !(await handedBackMock(itemId));
  },
  isTaskAwaitingCi: async () => awaitingCi,
  readTaskAwaitingCi: async () => {
    if (lookupFails === 'ci') throw new Error('database unavailable');
    return awaitingCi;
  },
  listAwaitingCi: async () => [],
}));
// The stuck branch asks the review hold; unmocked it reached an unreachable DB and outlived the
// 8 s case timeout.
mock.module('./review-hold', () => ({ readReviewHold: async () => null }));
mock.module('./verify-settle-live-verifier', () => ({ isVerifierStillRunning: async () => false }));
mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: resolveTaskWorkflowStateMock,
}));

// Task 1585: the settle wait asks for a recent verification stop; the real lookup reaches the DB.
mock.module('./publish/verification-stop-record', () => ({
  hasFreshVerificationStop: async () => false,
}));
const hasFreshVerifyRejectionMock = mock(
  (_taskId: number): Promise<boolean> => Promise.resolve(false),
);
mock.module('./verify-self-repair', () => ({
  hasFreshVerifyRejection: hasFreshVerifyRejectionMock,
}));

const recoverFromLandedArtifactMock = mock(
  (_taskId: number): Promise<boolean> => Promise.resolve(true),
);
const pendingMergeMock = mock(async () => false);
const conflictPendingMock = mock(async () => false);
mock.module('./verify-settle-artifact-recovery', () => ({
  recoverFromLandedArtifact: recoverFromLandedArtifactMock,
  isAwaitingRequiredMerge: pendingMergeMock,
  hasConflictResolutionPending: conflictPendingMock,
}));

const { waitForVerifyCompletion } = await import('./workflow-runner-verify-settle');

function state(overrides: Partial<TaskWorkflowState>): TaskWorkflowState {
  return {
    id: 1,
    status: 'in-progress',
    workflowStatus: 'verify_done',
    workflowMode: null,
    parentId: null,
    ...overrides,
  };
}

describe('waitForVerifyCompletion — fresh-rejection guard on landed-artifact completion', () => {
  test('releases abort listeners after ordinary merge polling completes', async () => {
    resolveWorkflowStateSequence = [
      state({}),
      state({}),
      state({ status: 'done', workflowStatus: 'completed' }),
    ];
    pendingMergeMock.mockResolvedValue(true);
    const controller = new AbortController();
    expect(await waitForVerifyCompletion(1, controller.signal)).toBe('completed');
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  }, 10000);
  test('keeps a required merge pending beyond the verification grace period', async () => {
    resolveWorkflowStateSequence = [
      state({}),
      state({}),
      state({ status: 'done', workflowStatus: 'completed' }),
    ];
    pendingMergeMock.mockResolvedValue(true);
    expect(await waitForVerifyCompletion(1, new AbortController().signal)).toBe('completed');
    expect(pendingMergeMock).toHaveBeenCalled();
    expect(recoverFromLandedArtifactMock).not.toHaveBeenCalled();
  }, 10000);
  // Task 1568: the scheduler hands THIS item back (completed + awaiting_ci) while the runner polls.
  test('the item was handed back → the runner stops waiting without touching it', async () => {
    resolveWorkflowStateSequence = [state({}), state({})];
    handedBackMock.mockResolvedValue(true);
    expect(await waitForVerifyCompletion(1, new AbortController().signal, 77)).toBe('awaiting_ci');
    expect(handedBackMock).toHaveBeenCalledWith(77);
    expect(recoverFromLandedArtifactMock).not.toHaveBeenCalled();
  }, 10000);
  // Task 1568 R1: after the hand-back the item is no longer the runner's — whatever the task did
  // next (merged by the watcher, or sent to repair by ci-self-repair), the runner only stops.
  test('hand-back, then the watcher completed the task: awaiting_ci, not completed (no re-completion)', async () => {
    resolveWorkflowStateSequence = [state({ status: 'done', workflowStatus: 'completed' })];
    handedBackMock.mockResolvedValue(true);
    expect(await waitForVerifyCompletion(1, new AbortController().signal, 77)).toBe('awaiting_ci');
  });
  test('hand-back, then ci-self-repair moved the task on: awaiting_ci, not moved (no advance)', async () => {
    resolveWorkflowStateSequence = [state({ workflowStatus: 'implement' })];
    handedBackMock.mockResolvedValue(true);
    expect(await waitForVerifyCompletion(1, new AbortController().signal, 77)).toBe('awaiting_ci');
  });
  test('hand-back, then the task row vanished: awaiting_ci, not a stuck/landed-artifact verdict', async () => {
    resolveWorkflowStateSequence = [null];
    handedBackMock.mockResolvedValue(true);
    expect(await waitForVerifyCompletion(1, new AbortController().signal, 77)).toBe('awaiting_ci');
    expect(recoverFromLandedArtifactMock).not.toHaveBeenCalled();
  });
  test('without an item id the hand-back is never consulted (manual runs keep the old wait)', async () => {
    resolveWorkflowStateSequence = [state({ status: 'done', workflowStatus: 'completed' })];
    expect(await waitForVerifyCompletion(1, new AbortController().signal)).toBe('completed');
    expect(handedBackMock).not.toHaveBeenCalled();
  });
  // task 1053 (2026-09-25): PR #813 DIRTY, resolver #1078 filed, the runner
  // kept holding the theme's slot for the merge the resolver could not reach.
  test('競合解消タスクが起票済みなら merge 待ちを続けず deferred でスロットを返す', async () => {
    resolveWorkflowStateSequence = [state({}), state({}), state({})];
    pendingMergeMock.mockResolvedValue(true);
    conflictPendingMock.mockResolvedValue(true);
    expect(await waitForVerifyCompletion(1, new AbortController().signal)).toBe('deferred');
    expect(recoverFromLandedArtifactMock).not.toHaveBeenCalled();
  }, 10000);

  beforeEach(() => {
    handedBackMock.mockReset().mockResolvedValue(false);
    pendingMergeMock.mockReset().mockResolvedValue(false);
    conflictPendingMock.mockReset().mockResolvedValue(false);
    resolveTaskWorkflowStateMock.mockClear();
    hasFreshVerifyRejectionMock.mockClear();
    recoverFromLandedArtifactMock.mockClear();
    hasFreshVerifyRejectionMock.mockImplementation(() => Promise.resolve(false));
    recoverFromLandedArtifactMock.mockImplementation(() => Promise.resolve(true));
    resolveWorkflowStateSequence = [];
    resolveWorkflowStateCallIndex = 0;
  });

  test('フレッシュな拒否がある間はPRが実在しても強制完了をスキップする（stuck）', async () => {
    resolveWorkflowStateSequence = [null];
    hasFreshVerifyRejectionMock.mockImplementation(() => Promise.resolve(true));

    const result = await waitForVerifyCompletion(1, new AbortController().signal);

    expect(result).toBe('stuck');
    expect(hasFreshVerifyRejectionMock).toHaveBeenCalledWith(1);
    expect(recoverFromLandedArtifactMock).not.toHaveBeenCalled();
  });

  test('フレッシュな拒否がなければPR実在で従来どおり完了する（回帰防止）', async () => {
    resolveWorkflowStateSequence = [null];
    hasFreshVerifyRejectionMock.mockImplementation(() => Promise.resolve(false));
    recoverFromLandedArtifactMock.mockImplementation(() => Promise.resolve(true));

    const result = await waitForVerifyCompletion(1, new AbortController().signal);

    expect(result).toBe('completed');
    expect(recoverFromLandedArtifactMock).toHaveBeenCalledWith(1);
  });

  test('猶予窓超過時もフレッシュな拒否があれば強制完了をスキップする（stuck）', async () => {
    resolveWorkflowStateSequence = [state({ workflowStatus: 'verify_done' })];
    hasFreshVerifyRejectionMock.mockImplementation(() => Promise.resolve(true));
    recoverFromLandedArtifactMock.mockImplementation(() => Promise.resolve(true));

    const result = await waitForVerifyCompletion(1, new AbortController().signal);

    expect(result).toBe('stuck');
    expect(recoverFromLandedArtifactMock).not.toHaveBeenCalled();
  }, 8000);

  // The counterexample table: whatever the runner cannot rule out, it withdraws from.
  test.each([
    ['task waits for CI', true, null, 'awaiting_ci', 0],
    ['CI-wait read fails while the recovery itself would work', false, 'ci', 'awaiting_ci', 0],
    ['task read as not waiting (control)', false, null, 'completed', 1],
  ] as const)('recovery of a vanished task: %s', async (_n, waits, fails, verdict, recoveries) => {
    awaitingCi = waits;
    lookupFails = fails;
    resolveWorkflowStateSequence = [null];
    hasFreshVerifyRejectionMock.mockImplementation(() => Promise.resolve(false));
    recoverFromLandedArtifactMock.mockClear();
    recoverFromLandedArtifactMock.mockImplementation(() => Promise.resolve(true));
    try {
      expect(await waitForVerifyCompletion(1, new AbortController().signal)).toBe(verdict);
      expect(recoverFromLandedArtifactMock).toHaveBeenCalledTimes(recoveries);
    } finally {
      awaitingCi = false;
      lookupFails = null;
    }
  });

  test('past the grace window an unreadable CI wait withdraws instead of recovering or failing', async () => {
    lookupFails = 'ci';
    resolveWorkflowStateSequence = [state({ workflowStatus: 'verify_done' })];
    pendingMergeMock.mockResolvedValue(false);
    hasFreshVerifyRejectionMock.mockImplementation(() => Promise.resolve(false));
    recoverFromLandedArtifactMock.mockClear();
    try {
      expect(await waitForVerifyCompletion(1, new AbortController().signal)).toBe('awaiting_ci');
      expect(recoverFromLandedArtifactMock).not.toHaveBeenCalled();
    } finally {
      lookupFails = null;
    }
  }, 8000);

  test('an ownership lookup that throws ends the wait without touching anything', async () => {
    lookupFails = 'ownership';
    resolveWorkflowStateSequence = [state({ workflowStatus: 'verify_done' })];
    recoverFromLandedArtifactMock.mockClear();
    try {
      const result = await waitForVerifyCompletion(1, new AbortController().signal, 99);
      expect(result).toBe('awaiting_ci');
      expect(recoverFromLandedArtifactMock).not.toHaveBeenCalled();
    } finally {
      lookupFails = null;
    }
  });

  test('an item that is not ours any more (missing row, unreadable, handed back) ends the wait: awaiting_ci', async () => {
    // isItemStillOwned answers false for all of them; the wait must not keep polling.
    handedBackMock.mockResolvedValue(true);
    resolveWorkflowStateSequence = [state({ workflowStatus: 'verify_done' })];
    const result = await waitForVerifyCompletion(1, new AbortController().signal, 99);
    expect(result).toBe('awaiting_ci');
    expect(recoverFromLandedArtifactMock).not.toHaveBeenCalled();
    handedBackMock.mockResolvedValue(false);
  });
});
