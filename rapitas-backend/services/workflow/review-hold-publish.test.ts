/**
 * review-hold-publish テスト
 *
 * An override waives the review only: the verification gate inside commit/PR
 * still decides, a missing PR still blocks, a requested merge still waits.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));
const updateMany = mock(async (_a: unknown) => ({ count: 1 }));
mock.module('../../config/database', () => ({ prisma: { task: { updateMany } } }));
const recordTransition = mock(async (_t: Record<string, unknown>) => {});
mock.module('./transition-recorder', () => ({ recordTransition }));
const writeBlockedTask = mock(async () => {});
mock.module('./blocked-task-write', () => ({ writeBlockedTask }));
let linked = false;
mock.module('./workflow-cli-executor-helpers', () => ({ taskHasLinkedPr: async () => linked }));
const holdForRequiredMerge = mock(async (_p: unknown) => true);
mock.module('./required-merge-hold', () => ({ holdForRequiredMerge }));
let mergeRequired = false;
mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: async () => mergeRequired,
  isAwaitingStagedPrCompletion: async () => false,
}));
type Acpr = Record<string, unknown>;
const performAutoCommitAndPR = mock(async (..._a: unknown[]): Promise<Acpr> => ({}));
mock.module('../../routes/workflow/workflow-auto-commit', () => ({
  performAutoCommitAndPR,
  isNoChangeCompletion: () => false,
}));
const handleVerifyGateBlocked = mock(async (_p: unknown) => ({ newStatus: 'plan_approved' }));
mock.module('../../routes/workflow/handlers/file-save/verify-commit-pr-gate-blocked', () => ({
  handleVerifyGateBlocked,
}));

const { publishAfterReviewOverride } = await import('./review-hold-publish');

beforeEach(() => {
  linked = false;
  mergeRequired = false;
  updateMany.mockClear();
  recordTransition.mockClear();
  writeBlockedTask.mockClear();
  holdForRequiredMerge.mockClear();
  handleVerifyGateBlocked.mockClear();
  performAutoCommitAndPR.mockReset().mockResolvedValue({
    requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
    autoPRResult: { success: true },
  });
});

describe('publishAfterReviewOverride', () => {
  test('PR ができ、マージ待ちが不要なら完了（上書きで完了したことを記録）', async () => {
    expect(await publishAfterReviewOverride(5, '# verify')).toBe('completed');
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 5, workflowStatus: 'verify_done' },
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_passed', metadata: { reviewOverride: true } }),
    );
  });

  test('検証ゲート（lint/型/テスト）の失敗は上書きされず修復ループへ', async () => {
    performAutoCommitAndPR.mockResolvedValue({ verificationBlocked: true, error: 'tsc failed' });
    expect(await publishAfterReviewOverride(5, '# verify')).toBe('gate_blocked');
    expect(handleVerifyGateBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, gateReason: 'tsc failed' }),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('PR ができなければ完了にせず blocked（verify_pr_not_created）', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoPRResult: { success: false, error: 'gh failed' },
    });
    expect(await publishAfterReviewOverride(5, '# verify')).toBe('pr_not_created');
    expect(writeBlockedTask).toHaveBeenCalled();
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_pr_not_created' }),
    );
  });

  test('マージが求められていれば watcher 待ちの保留', async () => {
    mergeRequired = true;
    expect(await publishAfterReviewOverride(5, '# verify')).toBe('held_for_merge');
    expect(holdForRequiredMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 5,
        fromStatus: 'verify_done',
        source: 'review-hold-override',
      }),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
