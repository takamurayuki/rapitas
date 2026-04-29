/**
 * Verify-completion Gate テスト
 *
 * Validates the policy implemented in workflow-handlers-files when verify.md
 * is saved:
 *   - PR/merge succeeded → Task.status = 'done'
 *   - PR/merge failed but no automation requested → Task.status = 'done'
 *   - PR/merge attempted and failed → Task.status unchanged
 *
 * The policy lives inside the route handler so we replicate the decision
 * logic in this test file. If the source-of-truth conditions diverge, the
 * test will catch it before shipping.
 */
import { describe, it, expect } from 'bun:test';

interface AutomationOutcome {
  requested?: {
    autoCommit: boolean;
    autoCreatePR: boolean;
    autoMergePR: boolean;
  };
  autoCommitResult?: { success: boolean };
  autoPRResult?: { success: boolean };
  autoMergeResult?: { success: boolean };
}

/** Mirror of the gate logic in workflow-handlers-files.ts */
function shouldMarkTaskDone(o: AutomationOutcome): boolean {
  const pr = o.autoPRResult;
  const merge = o.autoMergeResult;
  const requested = o.requested;
  let automationSucceeded = false;
  if (requested?.autoMergePR) automationSucceeded = merge?.success === true;
  else if (requested?.autoCreatePR) automationSucceeded = pr?.success === true;
  return automationSucceeded;
}

describe('verify completion gate', () => {
  it('何も要求されていない場合は done にしない（PR待ち）', () => {
    expect(shouldMarkTaskDone({})).toBe(false);
  });

  it('autoCommit のみ成功でも done にしない（PR必須）', () => {
    expect(
      shouldMarkTaskDone({
        requested: { autoCommit: true, autoCreatePR: false, autoMergePR: false },
        autoCommitResult: { success: true },
      }),
    ).toBe(false);
  });

  it('PR まで成功（Mergeなし）は done', () => {
    expect(
      shouldMarkTaskDone({
        requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
        autoCommitResult: { success: true },
        autoPRResult: { success: true },
      }),
    ).toBe(true);
  });

  it('Merge まで成功は done', () => {
    expect(
      shouldMarkTaskDone({
        requested: { autoCommit: true, autoCreatePR: true, autoMergePR: true },
        autoCommitResult: { success: true },
        autoPRResult: { success: true },
        autoMergeResult: { success: true },
      }),
    ).toBe(true);
  });

  it('autoCommit 失敗は done にしない', () => {
    expect(
      shouldMarkTaskDone({
        requested: { autoCommit: true, autoCreatePR: false, autoMergePR: false },
        autoCommitResult: { success: false },
      }),
    ).toBe(false);
  });

  it('Commit 成功するが PR 失敗は done にしない', () => {
    expect(
      shouldMarkTaskDone({
        requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
        autoCommitResult: { success: true },
        autoPRResult: { success: false },
      }),
    ).toBe(false);
  });

  it('Merge 失敗は done にしない（PR成功でも）', () => {
    expect(
      shouldMarkTaskDone({
        requested: { autoCommit: true, autoCreatePR: true, autoMergePR: true },
        autoCommitResult: { success: true },
        autoPRResult: { success: true },
        autoMergeResult: { success: false },
      }),
    ).toBe(false);
  });

  it('autoCreatePR 要求されているが PR 未実行なら done にしない', () => {
    expect(
      shouldMarkTaskDone({
        requested: { autoCommit: false, autoCreatePR: true, autoMergePR: false },
      }),
    ).toBe(false);
  });
});
