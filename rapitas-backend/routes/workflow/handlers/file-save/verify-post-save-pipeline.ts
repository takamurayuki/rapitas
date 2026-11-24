import type { CompletionReviewReceipt } from '../../../../services/workflow/requirement-replan-commit';
/**
 * FileSave Verify Post-Save Pipeline
 *
 * Runs everything that follows a passing verify.md save — the empty-diff
 * completion gate, the adversarial jury review and the commit / PR / merge
 * completion — as ONE unit of work registered with the verify-completion
 * in-flight registry before any of it is awaited. When the save left the task
 * waiting for the diff review (task 1538), the jury runs first and
 * `verify_done` is written only after it passes.
 * Not responsible for the stage logic itself; only for the ordering and for
 * the registration boundary.
 */

import type { WorkflowFileType } from '../../core/workflow-helpers';
import { registerVerifyCompletion } from '../../../../services/workflow/verify-completion-inflight';
import { runVerifyCompletionGate } from './verify-completion-gate';
import { runAdversarialDiffReview } from './verify-adversarial-review';
import { runVerifyCommitPrCompletion, type CommitPrCompletionOutcome } from './verify-commit-pr';
import type { VerifyReviewAdmission } from './verify-review-admission';

/**
 * Runs the post-save automation for a verify.md that just reached `verify_done`.
 *
 * The task's `workflowStatus` is already `verify_done` in the DB by the time
 * this is called, so the WorkflowRunner's verify-settle wait can observe it
 * from its very first poll. Task 658 (task 660): only the commit/PR stage was
 * registered in-flight, so the gate + LLM jury that precede it (jurors time
 * out at 120s each) ran with the registry empty, the runner's 60s window
 * expired at 63s and a task whose PR #458 landed 3.5 minutes later was parked
 * as blocked. Registering the whole sequence here, BEFORE the first await,
 * closes that gap: there is no longer any moment between the DB write and the
 * final outcome in which the automation is running but unregistered.
 *
 * Every early exit inside the three stages (gate blocked, jury FAIL bounce,
 * recovery exhausted) is a normal `return` from those functions, so the
 * wrapped Promise settles and the registry entry is released on all of them.
 *
 * @param params - taskId / fileType / newStatus after the status transition / saved verify.md content / 入力一式
 * @returns The completion outcome (pass-through when the save was not a passing verify)
 */
export async function runVerifyPostSaveAutomation(params: {
  completionReceipt?: CompletionReviewReceipt;
  /** The save's verify_done admission (verify-review-admission.ts). */
  admission?: VerifyReviewAdmission;
  taskId: number;
  fileType: WorkflowFileType;
  newStatus: string | undefined;
  savedContent: string;
}): Promise<CommitPrCompletionOutcome> {
  const { taskId, fileType, newStatus, savedContent } = params;

  if (fileType !== 'verify' || newStatus !== 'verify_done') {
    return { newStatus, taskMarkedDone: false, autoCommitPRResult: {} };
  }

  const admission = params.admission;
  if (admission?.reviewPending) {
    // Registered before the first await for the same reason as below: the
    // task is in_progress until the jury passes, and the CLI epilogue waits on
    // this registration instead of completing the phase itself.
    const pending = runReviewPendingAutomation({ taskId, fileType, savedContent, admission });
    registerVerifyCompletion(taskId, pending);
    return pending;
  }

  const work = (async (): Promise<CommitPrCompletionOutcome> => {
    const completionGate = await runVerifyCompletionGate({
      completionReceipt: params.completionReceipt,
      taskId,
      fileType,
      newStatus,
      savedContent,
    });
    const { conflictTask, isConflictResolutionTask, preferredBaseBranchForVerify } = completionGate;

    const adversarial = await runAdversarialDiffReview({
      taskId,
      fileType,
      newStatus,
      verifyGateBlocked: completionGate.verifyGateBlocked,
      isConflictResolutionTask,
      savedContent,
      preferredBaseBranchForVerify,
      reuseReview: admission?.reuseReview,
    });

    return runVerifyCommitPrCompletion({
      completionReceipt: params.completionReceipt,
      taskId,
      fileType,
      newStatus: adversarial.newStatus,
      // NOTE: A deferred eligibility decision (verifier model not reported yet)
      // lets the jury run above but never commit/PR/complete here — the run's
      // epilogue or the manual post-run settle decides once the model is known.
      verifyGateBlocked:
        adversarial.verifyGateBlocked || completionGate.completionDeferred === true,
      staleVerifyRequest: adversarial.staleVerifyRequest,
      isConflictResolutionTask,
      conflictTask,
      savedContent,
      preferredBaseBranchForVerify,
    });
  })();

  // Register synchronously, before the first await: the runner may poll this
  // task at any moment after the verify_done write above, and must see it as
  // live work from the gate onward — not only once commit/PR begins.
  registerVerifyCompletion(taskId, work);
  return work;
}

async function liveWorkflowStatus(taskId: number): Promise<string | undefined> {
  const { prisma } = await import('../../../../config');
  const row = await prisma.task
    .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
    .catch(() => null);
  return row?.workflowStatus ?? undefined;
}

/**
 * The post-save automation of a verify.md whose `verify_done` waits for the
 * diff review (task 1538): jury first, `verify_done` only after it passes,
 * then the usual completion gate and commit/PR. A FAIL bounces straight from
 * the status the task stayed at, never passing through `verify_done`.
 *
 * NOTE: The jury runs BEFORE the completion gate here, unlike the immediate
 * path. The gate's empty-diff block and the verifier-eligibility hold rely on
 * mechanisms keyed on `verify_done` (verifier-eligibility-settle.ts,
 * review-hold.ts), so the gate keeps running at the status it always saw.
 */
async function runReviewPendingAutomation(p: {
  taskId: number;
  fileType: WorkflowFileType;
  savedContent: string;
  admission: VerifyReviewAdmission;
}): Promise<CommitPrCompletionOutcome> {
  const { taskId, fileType, savedContent, admission } = p;
  const { recordVerifyReviewPending } = await import('./verify-review-admission');
  await recordVerifyReviewPending(taskId, admission);
  const { resolvePreferredBaseBranch } = await import('../../../../services/task/task-resolver');
  const preferredBaseBranchForVerify = await resolvePreferredBaseBranch(taskId).catch(() => null);
  const adversarial = await runAdversarialDiffReview({
    taskId,
    fileType,
    newStatus: 'verify_done',
    reviewFromStatus: admission.reviewFromStatus,
    verifyGateBlocked: false,
    isConflictResolutionTask: false,
    savedContent,
    preferredBaseBranchForVerify,
  });
  if (adversarial.verifyGateBlocked || adversarial.staleVerifyRequest) {
    // verify_done was never written (a hold stays at in_progress too); report
    // the status the task is really at, not the target this save aimed for.
    const reported =
      adversarial.newStatus === 'verify_done'
        ? ((await liveWorkflowStatus(taskId)) ?? adversarial.newStatus)
        : adversarial.newStatus;
    return runVerifyCommitPrCompletion({
      completionReceipt: admission.completionReceipt,
      taskId,
      fileType,
      newStatus: reported,
      verifyGateBlocked: adversarial.verifyGateBlocked,
      staleVerifyRequest: adversarial.staleVerifyRequest,
      isConflictResolutionTask: false,
      conflictTask: null,
      savedContent,
      preferredBaseBranchForVerify,
    });
  }

  let completionReceipt: CompletionReviewReceipt;
  try {
    const [{ prisma }, { advanceReviewedVerify }] = await Promise.all([
      import('../../../../config'),
      import('../../../../services/workflow/requirement-replan-commit'),
    ]);
    completionReceipt = await advanceReviewedVerify(prisma, admission.completionReceipt);
  } catch {
    // Another path moved the task on (replan, stop, pause) while the jury ran.
    return {
      newStatus: await liveWorkflowStatus(taskId),
      taskMarkedDone: false,
      autoCommitPRResult: {},
    };
  }

  const completionGate = await runVerifyCompletionGate({
    completionReceipt,
    taskId,
    fileType,
    newStatus: 'verify_done',
    savedContent,
  });
  return runVerifyCommitPrCompletion({
    completionReceipt,
    taskId,
    fileType,
    newStatus: 'verify_done',
    verifyGateBlocked:
      completionGate.verifyGateBlocked || completionGate.completionDeferred === true,
    staleVerifyRequest: false,
    isConflictResolutionTask: completionGate.isConflictResolutionTask,
    conflictTask: completionGate.conflictTask,
    savedContent,
    preferredBaseBranchForVerify: completionGate.preferredBaseBranchForVerify,
  });
}
