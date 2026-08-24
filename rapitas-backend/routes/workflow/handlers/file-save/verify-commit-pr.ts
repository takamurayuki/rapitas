/**
 * FileSave Verify Commit/PR Completion
 *
 * Auto commit / PR / merge for a passing verify.md, the gate-side
 * history-contamination retry, the PR-required completion gate, staged
 * completion, conflict-resolution direct completion, and the post-completion
 * fire-and-forget side effects.
 * Not responsible for the empty-diff gate or the adversarial review.
 */

import { prisma } from '../../../../config';
import { createLogger } from '../../../../config/logger';
import type { WorkflowFileType } from '../../core/workflow-helpers';
import type { performAutoCommitAndPR } from '../../workflow-auto-commit';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import { registerVerifyCompletion } from '../../../../services/workflow/verify-completion-inflight';
import {
  runVerifyCommitPrPipeline,
  type CommitPrCompletionOutcome,
} from './verify-commit-pr-pipeline';

const log = createLogger('routes:workflow:handlers:files');

export type { CommitPrCompletionOutcome };

/**
 * Runs commit/PR/merge and the completion gates for a passing verify.md save.
 *
 * Auto commit and PR creation when saving verify.md.
 *
 * NOTE: reaching this stage's active branch means verify.md passed validation
 * (the failure branch upstream holds the task at `in_progress`/`blocked` and
 * leaves newStatus undefined). Per the user's request — "verify.md を保存し、
 * 問題がなければステータスを完了に" — a passing verification now completes the
 * task directly. Auto-commit / PR / merge still run as a BEST-EFFORT side
 * effect (so branches with real changes still get a PR), but completion no
 * longer depends on a PR being published... except that completion REQUIRES a
 * successfully created PR when one was requested (see the gate below).
 *
 * @param params - taskId / fileType / newStatus / gate flags / conflict info / content / base branch / 入力一式
 * @returns The completion outcome (pass-through when the gates skip this stage)
 */
export async function runVerifyCommitPrCompletion(params: {
  taskId: number;
  fileType: WorkflowFileType;
  newStatus: string | undefined;
  verifyGateBlocked: boolean;
  staleVerifyRequest: boolean;
  isConflictResolutionTask: boolean;
  conflictTask: { title: string | null; githubPrId: number | null } | null;
  savedContent: string;
  preferredBaseBranchForVerify: string | null;
}): Promise<CommitPrCompletionOutcome> {
  const {
    taskId,
    fileType,
    staleVerifyRequest,
    isConflictResolutionTask,
    conflictTask,
    savedContent,
    preferredBaseBranchForVerify,
  } = params;
  let newStatus = params.newStatus;
  const verifyGateBlocked = params.verifyGateBlocked;

  let autoCommitPRResult: Awaited<ReturnType<typeof performAutoCommitAndPR>> = {};
  let taskMarkedDone = false;
  if (
    fileType === 'verify' &&
    newStatus === 'verify_done' &&
    !verifyGateBlocked &&
    !staleVerifyRequest &&
    isConflictResolutionTask
  ) {
    // Conflict-resolution task: the fix was already pushed to the existing PR
    // branch, so there is no new commit/PR to make and the scope check does not
    // apply. Complete directly — the PR (task.githubPrId) is what carries the work.
    // Compare-and-swap on verify_done: a concurrent duplicate of this save
    // (task 594 recorded the same completion twice, 242ms apart) must not
    // record a second completion transition — only the request that actually
    // flips the row completes and records. Mirrors the repair rollback below.
    const completed = await prisma.task
      .updateMany({
        where: { id: taskId, workflowStatus: 'verify_done' },
        data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
      })
      .catch(() => ({ count: 0 }));
    if (completed.count === 0) {
      log.warn(
        { taskId, prNumber: conflictTask?.githubPrId },
        '[Workflow] Conflict-resolution completion already applied by a concurrent request — skipping duplicate transition',
      );
    } else {
      taskMarkedDone = true;
      await recordTransition({
        taskId,
        fromStatus: 'verify_done',
        toStatus: 'completed',
        actor: 'system',
        cause: 'conflict_resolution_completed',
        phase: 'verify',
        metadata: { prNumber: conflictTask?.githubPrId },
      });
      log.info(
        { taskId, prNumber: conflictTask?.githubPrId },
        '[Workflow] Conflict-resolution task completed (work pushed to PR branch; commit/PR/scope gates skipped).',
      );
    }
  } else if (
    fileType === 'verify' &&
    newStatus === 'verify_done' &&
    !verifyGateBlocked &&
    !staleVerifyRequest
  ) {
    // Run the commit/PR/merge pipeline (initial attempt, history-contamination
    // recovery retry, and the completion gates — see verify-commit-pr-pipeline.ts).
    // Registered as in-flight for the WHOLE pipeline so the WorkflowRunner's
    // verify-settle wait knows this is live work rather than a stalled task:
    // registering only the initial attempt (pre-task-657) let the fixed 60s
    // window expire mid-recovery/retry and report a completed task (#653) as
    // blocked 79s before its PR actually landed.
    const pipelineWork = runVerifyCommitPrPipeline({
      taskId,
      savedContent,
      preferredBaseBranchForVerify,
    });
    registerVerifyCompletion(taskId, pipelineWork);
    const outcome = await pipelineWork;
    newStatus = outcome.newStatus;
    taskMarkedDone = outcome.taskMarkedDone;
    autoCommitPRResult = outcome.autoCommitPRResult;
  }

  return { newStatus, taskMarkedDone, autoCommitPRResult };
}
