/**
 * FileSave Shared Helpers
 *
 * Cross-stage helpers for the workflow file-save pipeline: the latest-execution
 * failure marker (re-exported from services) and the per-status allowed-file-type table.
 * Not responsible for any pipeline stage logic itself.
 */

import { prisma } from '../../../../config';
import type { WorkflowFileType } from '../../core/workflow-helpers';
import type { WorkflowStatus } from '../../../../services/workflow/workflow-types';
import { VERIFY_NON_CONVERGENCE_CAUSE } from '../../../../services/workflow/blocked-task-policy';

/** Max age for a non-convergence transition to count as "just recorded by this call". */
const CUTOFF_RECENCY_WINDOW_MS = 10_000;

/**
 * Whether attemptVerifyRepair()'s non-convergence cutoff already recorded its
 * own `verify_repair_non_convergence` transition for this task moments ago.
 *
 * attemptVerifyRepair() (verify-self-repair.ts) records that transition
 * SYNCHRONOUSLY before returning `bounced:false` on a cutoff, but its return
 * value carries no flag distinguishing that from the plain budget-exhausted
 * case (both return `{bounced:false}`). Reading the latest transition row —
 * scoped to a tight recency window so an unrelated older row can never be
 * mistaken for "just recorded" — lets the caller skip recording its OWN
 * transition for the same rejection instead of duplicating it (task 674: two
 * rows 43ms apart for one event).
 *
 * @param taskId - Task id / タスクID
 * @returns Whether the cutoff transition was just recorded / 直近にカットオフ遷移が記録されたか
 */
export async function wasNonConvergenceCutoffJustRecorded(taskId: number): Promise<boolean> {
  const last = await prisma.workflowTransition
    .findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      select: { cause: true, createdAt: true },
    })
    .catch(() => null);
  if (!last || last.cause !== VERIFY_NON_CONVERGENCE_CAUSE) return false;
  return Date.now() - last.createdAt.getTime() <= CUTOFF_RECENCY_WINDOW_MS;
}

// NOTE: Moved to services/workflow/publish so services can call it without
// importing routes; re-exported here so the file-save stages (and the tests
// that mock './shared') keep their import path.
export { markLatestExecutionFailed } from '../../../../services/workflow/publish/mark-latest-execution-failed';

/**
 * Per-status whitelist of workflow file types a save may target.
 *
 * Reject backward / out-of-order workflow file saves. Past incidents
 * showed agents (especially claude-code with full shell access) calling
 * `curl PUT /workflow/.../files/research` AFTER verify.md was already
 * saved, regressing the task to research_done and corrupting the
 * status machine. Each file type is only allowed when the task is in
 * a phase that can legitimately produce that artifact.
 */
export const ALLOWED_FILE_TYPES_BY_STATUS: Record<WorkflowStatus, ReadonlySet<WorkflowFileType>> = {
  draft: new Set(['research', 'question']),
  // 'verify' is allowed here for the LIGHTWEIGHT single-session flow
  // (research→implement→verify, NO plan phase — e.g. conflict-resolution
  // tasks): one agent reaches verify.md while workflowStatus is still
  // research_done, because no plan phase ever advanced it to plan_approved.
  // Without this the save is rejected and the agent must manually PUT
  // /status to in_progress first. Forward-only; the completion gate
  // (evaluateCompletionGate) still blocks completions with no real diff.
  research_done: new Set(['plan', 'question', 'research', 'verify']),
  plan_created: new Set(['plan', 'question']),
  // 'verify' is allowed here for the dev-mode single-session flow: ONE agent
  // does research→plan→implement→verify in a single run, so it reaches
  // verify.md while workflowStatus is still plan_approved (no separate
  // implementer PHASE ever advanced it to in_progress). Hard-rejecting it
  // surfaced a ValidationError in the UI and stranded the run with no
  // commit/PR. Forward-only; the completion gate (evaluateCompletionGate)
  // still blocks completions that have no real code diff.
  plan_approved: new Set(['verify', 'question']),
  in_progress: new Set(['verify', 'question']),
  // 質問待ち中も同じファイルが書ける（質問解消は別 API か question.md 削除で行う）
  awaiting_question: new Set(['research', 'plan', 'verify', 'question']),
  // 'question' only (never 'verify' — see retry-rollback-contract.test.ts /
  // guards.ts for why verify_done must stay unable to record a verify.md).
  // A question raised while sitting at verify_done resolves to
  // completion_confirmation (question-kind-resolver.ts) and pauses to
  // awaiting_question without discarding the passing verify.md (task 902 —
  // without this entry the save was rejected here before kind resolution
  // ever ran, so completion_confirmation was unreachable via the real API).
  verify_done: new Set(['question']),
  completed: new Set([]),
};
