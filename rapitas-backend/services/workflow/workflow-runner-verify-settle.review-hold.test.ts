/**
 * workflow-runner-verify-settle.review-hold テスト
 *
 * A task parked for a human review decision is reported as 'held' — not as
 * a stuck/failed queue item — once the settle window passes.
 */
import { describe, test, expect, mock } from 'bun:test';
import type { TaskWorkflowState } from '../task/task-resolver';

process.env.RAPITAS_VERIFY_SETTLE_MS = '30';
process.env.RAPITAS_VERIFY_SETTLE_CAP_MS = '30';

const live: TaskWorkflowState = {
  id: 1,
  status: 'in-progress',
  workflowStatus: 'verify_done',
  workflowMode: null,
  parentId: null,
};
mock.module('../task/task-resolver', () => ({ resolveTaskWorkflowState: async () => live }));
mock.module('./verify-self-repair', () => ({ hasFreshVerifyRejection: async () => false }));
mock.module('./verify-settle-artifact-recovery', () => ({
  recoverFromLandedArtifact: async () => false,
  isAwaitingRequiredMerge: async () => false,
  hasConflictResolutionPending: async () => false,
}));
let held = true;
mock.module('./review-hold', () => ({
  readReviewHold: async () =>
    held ? { reason: 'unresolved_dispute', detail: '', findings: [] } : null,
  probeReviewHold: async () =>
    held
      ? { state: 'held', hold: { reason: 'unresolved_dispute', detail: '', findings: [] } }
      : { state: 'clear' },
}));

const { waitForVerifyCompletion, deferVerifyItem } =
  await import('./workflow-runner-verify-settle');

describe('waitForVerifyCompletion — review hold', () => {
  test('保留中のタスクは held（stuck ではない）', async () => {
    held = true;
    expect(await waitForVerifyCompletion(1, new AbortController().signal)).toBe('held');
  }, 10000);

  test('保留していなければ従来どおり stuck', async () => {
    held = false;
    expect(await waitForVerifyCompletion(1, new AbortController().signal)).toBe('stuck');
  }, 10000);

  test('held のキュー項目は awaiting_review として完了扱いにする（タスクは verify_done のまま）', async () => {
    const calls: unknown[] = [];
    await deferVerifyItem(
      { updateStatus: async (...a: unknown[]) => calls.push(a) },
      7,
      'review_hold',
    );
    const [id, status, extra] = calls[0] as [
      number,
      string,
      { currentPhase: string; result: string },
    ];
    expect([id, status, extra.currentPhase]).toEqual([7, 'completed', 'awaiting_review']);
    expect(JSON.parse(extra.result).reason).toBe('review_hold');
  });
});
