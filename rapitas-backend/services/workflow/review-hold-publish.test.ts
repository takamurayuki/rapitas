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
// The REAL classifier: a stub that always says "changed" hid the path where a
// no-change verdict swallowed a stop/publication error (G2 re-review item 2).
const { isNoChangeCompletion } =
  await import('../../routes/workflow/workflow-auto-commit-classify');
mock.module('../../routes/workflow/workflow-auto-commit', () => ({
  performAutoCommitAndPR,
  isNoChangeCompletion,
}));
const handleVerifyGateBlocked = mock(async (_p: unknown) => ({ newStatus: 'plan_approved' }));
mock.module('../../routes/workflow/handlers/file-save/verify-commit-pr-gate-blocked', () => ({
  handleVerifyGateBlocked,
}));

let currentSha: string | null = 'sha-5';
let currentFp: string | null = 'fp-5';
mock.module('./verify-jury-completion', () => ({ readVerifySha256: async () => currentSha }));
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => currentFp,
}));
const holdForHumanReview = mock(async (_p: Record<string, unknown>) => 'held' as const);
mock.module('./review-hold', () => ({ holdForHumanReview }));

const { publishAfterReviewOverride } = await import('./review-hold-publish');

const HOLD = {
  reason: 'unresolved_dispute' as const,
  detail: '検証席が判定できませんでした',
  findings: [{ severity: 'blocker' as const, summary: 'null 未処理', gating: true }],
  severity: 90,
};
const CTX = {
  binding: { verifySha256: 'sha-5', diffFingerprint: 'fp-5', worktreePath: '/wt/5' },
  hold: HOLD,
};
const publish = () => publishAfterReviewOverride(5, '# verify', CTX);

beforeEach(() => {
  currentSha = 'sha-5';
  currentFp = 'fp-5';
  holdForHumanReview.mockClear();
  linked = false;
  mergeRequired = false;
  updateMany.mockClear();
  recordTransition.mockClear();
  writeBlockedTask.mockClear();
  holdForRequiredMerge.mockClear();
  handleVerifyGateBlocked.mockClear();
  performAutoCommitAndPR.mockReset().mockResolvedValue({
    requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
    autoCommitResult: { success: true, filesChanged: 1 },
    autoPRResult: { success: true },
  });
});

describe('publishAfterReviewOverride', () => {
  test('PR ができ、マージ待ちが不要なら完了（上書きで完了したことを記録）', async () => {
    expect(await publish()).toBe('completed');
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 5, workflowStatus: 'verify_done' },
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_passed', metadata: { reviewOverride: true } }),
    );
  });

  test('検証ゲート（lint/型/テスト）の失敗は上書きされず修復ループへ', async () => {
    performAutoCommitAndPR.mockResolvedValue({ verificationBlocked: true, error: 'tsc failed' });
    expect(await publish()).toBe('gate_blocked');
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
    expect(await publish()).toBe('pr_not_created');
    expect(writeBlockedTask).toHaveBeenCalled();
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_pr_not_created' }),
    );
  });

  test('マージが求められていれば watcher 待ちの保留', async () => {
    mergeRequired = true;
    expect(await publish()).toBe('held_for_merge');
    expect(holdForRequiredMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 5,
        fromStatus: 'verify_done',
        source: 'review-hold-override',
      }),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('上書き後に verify.md が変わっていれば公開せず、保留へ戻す', async () => {
    currentSha = 'sha-6';
    expect(await publish()).toBe('binding_mismatch');
    expect(performAutoCommitAndPR).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(holdForHumanReview).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, reason: 'unresolved_dispute', findings: HOLD.findings }),
    );
    expect(String(holdForHumanReview.mock.calls[0][0].detail)).toContain('verify.md');
  });

  test('上書き後に差分が変わっていれば公開せず、保留へ戻す', async () => {
    currentFp = 'fp-other';
    expect(await publish()).toBe('binding_mismatch');
    expect(performAutoCommitAndPR).not.toHaveBeenCalled();
    expect(holdForHumanReview).toHaveBeenCalled();
  });

  test('識別子が取得できなければ公開せず、保留へ戻す', async () => {
    currentFp = null;
    expect(await publish()).toBe('binding_mismatch');
    currentFp = 'fp-5';
    currentSha = null;
    expect(await publish()).toBe('binding_mismatch');
    expect(performAutoCommitAndPR).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('コミットだけを求めた設定でローカル保存が失敗したら完了にしない', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: false, autoMergePR: false },
      autoCommitResult: { success: false, error: 'index.lock exists' },
      error: 'ローカル保存に失敗しました: index.lock exists',
    });
    expect(await publish()).toBe('publication_failed');
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeBlockedTask).toHaveBeenCalled();
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: 'verify_publication_failed',
        metadata: expect.objectContaining({ reason: expect.stringContaining('index.lock') }),
      }),
    );
  });

  test('停止（公開の取り消し）やエラーが返れば、PR がリンク済みでも完了にしない', async () => {
    linked = true;
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoCommitResult: { success: true, filesChanged: 2 },
      error: '公開は取り消されました',
    });
    expect(await publish()).toBe('publication_failed');
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('要求したコミットが成功していなければ、全体の error が無くても完了にしない', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: false, autoMergePR: false },
      autoCommitResult: { success: false, error: 'pre-commit hook rejected', filesChanged: 3 },
    });
    expect(await publish()).toBe('publication_failed');
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('commit/PR が例外で落ちたら完了にしない', async () => {
    linked = true;
    performAutoCommitAndPR.mockRejectedValue(new Error('boom'));
    expect(await publish()).toBe('publication_failed');
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('コミットだけの設定でコミットが成功すれば完了', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: false, autoMergePR: false },
      autoCommitResult: { success: true, filesChanged: 1 },
    });
    expect(await publish()).toBe('completed');
  });

  test('上書きの束縛（worktree・sha256・fingerprint）を commit/PR の実行側へ渡す', async () => {
    await publish();
    expect(performAutoCommitAndPR).toHaveBeenCalledWith(5, '# verify', { binding: CTX.binding });
  });

  test('commit/PR の実行側が束縛の不一致を検出したら、完了にせず保留へ戻す', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      bindingMismatch: '上書きした後に差分が変わりました',
      error: '上書きした後に差分が変わりました',
    });
    expect(await publish()).toBe('binding_mismatch');
    expect(updateMany).not.toHaveBeenCalled();
    expect(holdForHumanReview).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, reason: 'unresolved_dispute', findings: HOLD.findings }),
    );
  });

  test('レビュー再現：既にコミット済み（filesChanged 0）でも停止エラーがあれば完了にしない', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: true },
      autoCommitResult: { success: true, filesChanged: 0, alreadyCommitted: true },
      error: 'タスクが停止されたため、公開処理を中断しました。',
    });
    expect(await publish()).toBe('publication_failed');
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_no_change_confirmed' }),
    );
  });

  test('本当に公開する差分が無ければ（エラーなし）no-change として完了', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoCommitResult: { success: true, filesChanged: 0, alreadyCommitted: true },
      autoPRResult: { success: false, error: 'No commits between develop and feature/t5' },
    });
    expect(await publish()).toBe('completed');
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_no_change_confirmed' }),
    );
  });

  test('レビュー再現：既にコミット済み（filesChanged 0）で PR 個別の失敗があれば完了にしない', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: true },
      autoCommitResult: { success: true, filesChanged: 0, alreadyCommitted: true },
      autoPRResult: { success: false, error: 'GitHub authentication failed' },
    });
    expect(await publish()).toBe('pr_not_created');
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_no_change_confirmed' }),
    );
  });

  test('PR がリンク済みでも、PR ステップ（push）が失敗していれば完了にしない', async () => {
    linked = true;
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoCommitResult: { success: true, filesChanged: 1 },
      autoPRResult: { success: false, prNumber: 9, error: '既存 PR #9 への push に失敗しました' },
    });
    expect(await publish()).toBe('publication_failed');
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('マージのステップが失敗していれば完了にしない（watcher への委譲は除く）', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: true },
      autoCommitResult: { success: true, filesChanged: 1 },
      autoPRResult: { success: true, prNumber: 9 },
      autoMergeResult: { success: false, error: 'merge rejected' },
    });
    expect(await publish()).toBe('publication_failed');
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('マージを watcher へ委譲しただけ（deferred）なら失敗とみなさない', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: true },
      autoCommitResult: { success: true, filesChanged: 1 },
      autoPRResult: { success: true, prNumber: 9 },
      autoMergeResult: { success: false, deferred: true },
    });
    expect(await publish()).toBe('completed');
  });

  test('停止で PR まで進まなかった場合は、PR の再試行へ回さず公開失敗にする', async () => {
    performAutoCommitAndPR.mockResolvedValue({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoCommitResult: { success: true, filesChanged: 2 },
      error: 'タスクが停止されたため、公開処理を中断しました。',
    });
    expect(await publish()).toBe('publication_failed');
    expect(recordTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_pr_not_created' }),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
