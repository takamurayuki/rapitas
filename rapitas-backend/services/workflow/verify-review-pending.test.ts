/**
 * verify-review-pending.test
 *
 * The CLI epilogue's wait for a verify.md save whose diff review is still
 * deciding: it returns once the status leaves in_progress, once the save
 * pipeline is no longer registered, or at the wait limit.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let statuses: string[] = [];
const resolveMock = mock(async () => ({
  id: 1,
  status: 'in-progress',
  workflowStatus: statuses.length > 1 ? statuses.shift()! : statuses[0],
  workflowMode: null,
  parentId: null,
}));
mock.module('../task/task-resolver', () => ({ resolveTaskWorkflowState: resolveMock }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {} }),
}));

const { registerVerifyCompletion, resetVerifyCompletionRegistry } =
  await import('./verify-completion-inflight');
const { resolveSettledWorkflowState, VERIFY_REVIEW_PENDING_CAUSE } =
  await import('./verify-review-pending');

beforeEach(() => {
  resetVerifyCompletionRegistry();
  resolveMock.mockClear();
});

describe('resolveSettledWorkflowState', () => {
  it('登録中は状態が in_progress から変わるまで返らない', async () => {
    statuses = ['in_progress', 'in_progress', 'verify_done'];
    registerVerifyCompletion(1, new Promise(() => {}));
    const s = await resolveSettledWorkflowState(1, { outputFile: 'verify' }, { pollMs: 1 });
    expect(s?.workflowStatus).toBe('verify_done');
    expect(resolveMock).toHaveBeenCalledTimes(3);
  });

  it('登録が外れたら in_progress のままでも返る', async () => {
    statuses = ['in_progress'];
    let release!: () => void;
    registerVerifyCompletion(1, new Promise<void>((r) => (release = r)));
    setTimeout(() => release(), 5);
    const s = await resolveSettledWorkflowState(1, { outputFile: 'verify' }, { pollMs: 2 });
    expect(s?.workflowStatus).toBe('in_progress');
  });

  it('上限に達したら待つのをやめる', async () => {
    statuses = ['in_progress'];
    registerVerifyCompletion(1, new Promise(() => {}));
    const s = await resolveSettledWorkflowState(
      1,
      { outputFile: 'verify' },
      { maxWaitMs: 10, pollMs: 2 },
    );
    expect(s?.workflowStatus).toBe('in_progress');
  });

  it('verify 以外のフェーズや未登録なら1回だけ読む', async () => {
    statuses = ['in_progress'];
    registerVerifyCompletion(1, new Promise(() => {}));
    await resolveSettledWorkflowState(1, { outputFile: 'plan' });
    resetVerifyCompletionRegistry();
    await resolveSettledWorkflowState(1, { outputFile: 'verify' });
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });

  it('レビュー待ちの印は verify_review_pending である', () => {
    expect(VERIFY_REVIEW_PENDING_CAUSE).toBe('verify_review_pending');
  });
});
