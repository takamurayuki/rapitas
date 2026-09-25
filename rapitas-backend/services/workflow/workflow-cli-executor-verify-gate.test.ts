/**
 * workflow-cli-executor-verify-gate ユニットテスト (task 895)
 *
 * CLI/オーケストレータ駆動の verify エピローグが、autoMergePR 要求時に
 * PR 作成だけで done/completed へ進まないことを検証する。
 * autoMergePR 無効 / 未設定のケースでは従来どおり完了することも確認する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
const receipt = { taskId: 895 };
const reviewReplan = mock(
  async (): Promise<{
    committed: boolean;
    reason: string;
    completionReceipt?: typeof receipt;
  }> => ({ committed: false, reason: 'no_mismatch', completionReceipt: receipt }),
);
const completeReview = mock(async (_db: unknown, _receipt: unknown, _completion: unknown) => ({
  committed: true,
  reason: 'verify_passed',
}));
const preflight = mock(async () => undefined);
mock.module('./requirement-replan-commit', () => ({
  completeReviewedTask: completeReview,
  assertReviewedTaskCurrent: preflight,
}));
mock.module('./requirement-replan-service', () => ({ attemptRequirementReplan: reviewReplan }));

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const taskUpdate = mock(() => Promise.resolve({}));
mock.module('../../config', () => ({
  prisma: { task: { update: taskUpdate } },
}));

const recordTransition = mock(() => Promise.resolve());
mock.module('./transition-recorder', () => ({ recordTransition }));

mock.module('./workflow-file-utils', () => ({
  readWorkflowFile: mock(() => Promise.resolve('# verify')),
}));

mock.module('./completion-gate', () => ({
  evaluateCompletionGate: () => Promise.resolve({ allow: true, reason: 'real diff' }),
}));

mock.module('./durable-blocked-write', () => ({
  writeBlockedStatusDurable: mock(() => Promise.resolve()),
}));

const freshRejection = mock(async () => false);
mock.module('./verify-self-repair', () => ({
  hasFreshVerifyRejection: freshRejection,
  attemptVerifyRepair: () => Promise.resolve({ bounced: false, stale: false }),
}));

const linkedPr = mock(async () => true);
const autoCommit = mock(async () => ({}));
mock.module('../../routes/workflow/workflow-auto-commit', () => ({
  performAutoCommitAndPR: autoCommit,
  isNoChangeCompletion: () => false,
}));
mock.module('./workflow-cli-executor-helpers', () => ({
  taskHasLinkedPr: linkedPr,
  wasVerifyValidationFailureJustRecorded: () => Promise.resolve(false),
}));

let awaitingRequiredMerge = false;
let awaitingStagedPrCompletion = false;
mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: () => Promise.resolve(awaitingRequiredMerge),
  isAwaitingStagedPrCompletion: () => Promise.resolve(awaitingStagedPrCompletion),
}));

const holdForRequiredMerge = mock(() => Promise.resolve(true));
mock.module('./required-merge-hold', () => ({
  holdForRequiredMerge,
  AWAITING_REQUIRED_MERGE_CAUSE: 'verify_awaiting_required_merge',
}));

const inFlightWait = mock(async () => true);
mock.module('./pr-in-flight-wait', () => ({
  waitForInFlightPr: inFlightWait,
  PR_CREATION_IN_FLIGHT_ERROR: 'PR作成が別プロセスで進行中のためスキップしました',
}));

const { resolveVerifyPhaseStatus } = await import('./workflow-cli-executor-verify-gate');

/** Minimal passing-verify input: PR already linked, completion gate allows. */
function params() {
  return {
    taskId: 895,
    transition: { role: 'verifier', outputFile: 'verify', nextStatus: 'completed' },
    session: { id: 7 },
    currentWfStatus: 'verify_done',
    fileContent: '# 検証結果',
    validation: { ok: true, severity: 0, summary: 'ok', missingSections: [] },
    resolvedWorktreePath: 'C:\\work\\wt',
  } as unknown as Parameters<typeof resolveVerifyPhaseStatus>[0];
}

beforeEach(() => {
  linkedPr.mockReset().mockResolvedValue(true);
  preflight.mockReset().mockResolvedValue(undefined);
  autoCommit.mockClear();
  freshRejection.mockReset().mockResolvedValue(false);
  reviewReplan
    .mockReset()
    .mockResolvedValue({ committed: false, reason: 'no_mismatch', completionReceipt: receipt });
  completeReview.mockReset().mockResolvedValue({ committed: true, reason: 'verify_passed' });
  taskUpdate.mockClear();
  recordTransition.mockClear();
  holdForRequiredMerge.mockClear();
  awaitingRequiredMerge = false;
  awaitingStagedPrCompletion = false;
});

describe('resolveVerifyPhaseStatus — 完了と必須マージ待ちの分岐', () => {
  test('stale completion receipt cannot be reported as completed', async () => {
    completeReview.mockResolvedValueOnce({ committed: false, reason: 'execution_superseded' });
    await expect(resolveVerifyPhaseStatus(params())).rejects.toThrow('Reviewed completion held');
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('missing server receipt cannot fall back to id-only completion', async () => {
    reviewReplan.mockResolvedValueOnce({ committed: false, reason: 'no_mismatch' });
    await expect(resolveVerifyPhaseStatus(params())).rejects.toThrow('Missing server completion');
    expect(completeReview).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });
  test('an HTTP repair rejection owns the next action without another AI review', async () => {
    freshRejection.mockResolvedValueOnce(true);
    reviewReplan.mockRejectedValueOnce(new Error('must not review a rejected artifact'));
    expect(await resolveVerifyPhaseStatus({ ...params(), currentWfStatus: 'plan_approved' })).toBe(
      'plan_approved',
    );
    expect(reviewReplan).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  test('unreadable rejection history cannot proceed to review or completion', async () => {
    freshRejection.mockRejectedValueOnce(new Error('history unavailable'));
    await expect(resolveVerifyPhaseStatus(params())).rejects.toThrow('history unavailable');
    expect(reviewReplan).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  test('committed replan returns to planning without completion writes', async () => {
    reviewReplan.mockResolvedValueOnce({ committed: true, reason: 'requirement_evidence_replan' });
    expect(await resolveVerifyPhaseStatus(params())).toBe('research_done');
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
    expect(holdForRequiredMerge).not.toHaveBeenCalled();
  });

  test('unknown review cannot fall through to completion', async () => {
    reviewReplan.mockResolvedValueOnce({ committed: false, reason: 'unknown' });
    await expect(resolveVerifyPhaseStatus(params())).rejects.toThrow('review held');
    expect(taskUpdate).not.toHaveBeenCalled();
  });
  test('autoMergePR=true かつ PR あり: completed にせず verify_done で保留する', async () => {
    awaitingRequiredMerge = true;

    const status = await resolveVerifyPhaseStatus(params());

    expect(status).toBe('verify_done');
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(holdForRequiredMerge).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 895, source: 'WorkflowCLIExecutor' }),
    );
    expect(recordTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_passed' }),
    );
  });

  test('autoMergePR=false: 従来どおり done/completed にする', async () => {
    awaitingRequiredMerge = false;

    const status = await resolveVerifyPhaseStatus(params());

    expect(status).toBe('completed');
    expect(holdForRequiredMerge).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(completeReview).toHaveBeenCalledWith(expect.anything(), receipt, {
      cause: 'verify_passed',
      sessionId: 7,
    });
  });

  test('autoMergePR 未設定（isAwaitingRequiredMerge が false）でも完了できる', async () => {
    // 未設定は resolveAutomationPolicy の既定 (autoMergePR=false) に落ちるため
    // isAwaitingRequiredMerge が false を返す。= 上の false ケースと同じ経路。
    awaitingRequiredMerge = false;

    const status = await resolveVerifyPhaseStatus(params());

    expect(status).toBe('completed');
    expect(holdForRequiredMerge).not.toHaveBeenCalled();
  });

  test('pr モード×staged有効(isAwaitingStagedPrCompletion=true): completed にせず verify_done で保留する（task 873/948）', async () => {
    awaitingRequiredMerge = false;
    awaitingStagedPrCompletion = true;

    const status = await resolveVerifyPhaseStatus(params());

    expect(status).toBe('verify_done');
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(holdForRequiredMerge).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 895, source: 'WorkflowCLIExecutor (staged pr)' }),
    );
    expect(recordTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_passed' }),
    );
  });

  // task 1027 (2026-09-21): HTTP 保存側が PR 作成ロックを持ったまま base 同期中に、
  // CLI 側のエピローグが「PR なし」でタスクをブロックし、9 秒後にできた PR #786 は
  // in-progress しか見ない auto-merge watcher から不可視になった。
  test('PR 作成が別プロセスで進行中なら、ブロックせず PR の紐付けを待って完了する（task 1027）', async () => {
    linkedPr.mockReset().mockResolvedValue(false);
    autoCommit.mockResolvedValueOnce({
      requested: { autoCreatePR: true },
      autoPRResult: { success: false, error: 'PR作成が別プロセスで進行中のためスキップしました' },
    });
    inFlightWait.mockReset().mockResolvedValue(true);

    const status = await resolveVerifyPhaseStatus(params());

    expect(status).toBe('completed');
    expect(inFlightWait).toHaveBeenCalledWith(895);
    expect(recordTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_pr_not_created' }),
    );
  });

  test('待っても PR が紐付かなければ従来どおり verify_pr_not_created でブロックする', async () => {
    linkedPr.mockReset().mockResolvedValue(false);
    autoCommit.mockResolvedValueOnce({
      requested: { autoCreatePR: true },
      autoPRResult: { success: false, error: 'PR作成が別プロセスで進行中のためスキップしました' },
    });
    inFlightWait.mockReset().mockResolvedValue(false);

    const status = await resolveVerifyPhaseStatus(params());

    expect(status).toBe('verify_done');
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'verify_pr_not_created' }),
    );
  });

  test('isAwaitingRequiredMerge=true の場合、isAwaitingStagedPrCompletion 分岐より先に merge 保留になる（回帰確認）', async () => {
    awaitingRequiredMerge = true;
    awaitingStagedPrCompletion = true;

    const status = await resolveVerifyPhaseStatus(params());

    expect(status).toBe('verify_done');
    expect(holdForRequiredMerge).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 895, source: 'WorkflowCLIExecutor' }),
    );
  });
});

test('CLI preflight prevents committing after a stop request', async () => {
  linkedPr.mockResolvedValue(false);
  preflight.mockRejectedValueOnce(new Error('stop_not_resumed'));
  await expect(resolveVerifyPhaseStatus(params())).rejects.toThrow('stop_not_resumed');
  expect(autoCommit).not.toHaveBeenCalled();
  expect(completeReview).not.toHaveBeenCalled();
});
