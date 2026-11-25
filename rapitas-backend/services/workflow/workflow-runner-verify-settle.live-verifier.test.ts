/**
 * waitForVerifyCompletion — a verifier still running is still working
 *
 * Task 1547 (2026-11-25): the Codex verifier saved verify.md at 23:37:21 and
 * exited at 23:39:11. Commit / PR run after it exits, so nothing was
 * registered in flight; the 60 s settle window ran out at 23:38:34 and the
 * task was blocked before its PR could be made.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { TaskWorkflowState } from '../task/task-resolver';

process.env.RAPITAS_VERIFY_SETTLE_MS = '30';
process.env.RAPITAS_VERIFY_SETTLE_CAP_MS = '20000';

const live: TaskWorkflowState = {
  id: 1547,
  status: 'in-progress',
  workflowStatus: 'verify_done',
  workflowMode: null,
  parentId: null,
};

/** How many more liveness checks report the verifier as still running. */
let aliveChecks = 0;
mock.module('../task/task-resolver', () => ({ resolveTaskWorkflowState: async () => live }));
mock.module('./verify-self-repair', () => ({ hasFreshVerifyRejection: async () => false }));
mock.module('./verify-completion-inflight', () => ({ hasVerifyCompletionInFlight: () => false }));
mock.module('./verify-settle-artifact-recovery', () => ({
  // The PR only exists once the verifier has exited and the epilogue ran.
  recoverFromLandedArtifact: async () => aliveChecks <= 0,
  isAwaitingRequiredMerge: async () => false,
  hasConflictResolutionPending: async () => false,
}));
mock.module('./review-hold', () => ({
  readReviewHold: async () => null,
  probeReviewHold: async () => ({ state: 'clear' }),
}));
mock.module('./verify-settle-live-verifier', () => ({
  isVerifierStillRunning: async () => {
    if (aliveChecks <= 0) return false;
    aliveChecks -= 1;
    return true;
  },
}));

const { waitForVerifyCompletion } = await import('./workflow-runner-verify-settle');

describe('waitForVerifyCompletion with the verifier still running', () => {
  beforeEach(() => {
    aliveChecks = 0;
  });

  test('keeps waiting past the settle window, then completes from the landed PR', async () => {
    aliveChecks = 2;
    expect(await waitForVerifyCompletion(1547, new AbortController().signal)).toBe('completed');
  }, 15000);

  test('a verifier that already exited does not extend the window', async () => {
    aliveChecks = 0;
    expect(await waitForVerifyCompletion(1547, new AbortController().signal)).toBe('completed');
  }, 15000);
});
