/**
 * Verify Review Pending
 *
 * The "verify.md was saved and is waiting for the adversarial diff review"
 * marker, and the wait the CLI epilogue does before reading the task's
 * workflow status while that review is still deciding. Not responsible for
 * running the review or writing any status.
 *
 * Why: a passing verify.md no longer moves the task to `verify_done` on save;
 * it stays `in_progress` until the jury passes (task 1538). Without the wait,
 * the verifier's own epilogue would read `in_progress` mid-review and take the
 * phase's completion into its own hands, racing the save pipeline.
 */
import { createLogger } from '../../config/logger';
import { resolveTaskWorkflowState } from '../task/task-resolver';
import { hasVerifyCompletionInFlight } from './verify-completion-inflight';
import type { RoleTransition } from './workflow-types';

const log = createLogger('workflow:verify-review-pending');

/** WorkflowTransition.cause of the "waiting for the diff review" marker. */
export const VERIFY_REVIEW_PENDING_CAUSE = 'verify_review_pending' as const;

/** Default longest wait; past it the epilogue proceeds and the jury lock serialises. */
const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 1_000;

type WorkflowState = Awaited<ReturnType<typeof resolveTaskWorkflowState>>;

/**
 * Read the task's workflow state once the post-save review of a verify.md has
 * settled. Waits only for a verify phase whose save pipeline is still
 * registered and while the task is still `in_progress`; otherwise reads once.
 *
 * @param taskId - Task id / タスクID
 * @param transition - The phase that just ran / 実行したフェーズ
 * @param opts.maxWaitMs - Wait limit (tests shorten it) / 待機上限
 * @param opts.pollMs - Poll interval / 確認間隔
 * @returns The latest workflow state, or null when unreadable / 最新の状態
 */
export async function resolveSettledWorkflowState(
  taskId: number,
  transition: Pick<RoleTransition, 'outputFile'>,
  opts: { maxWaitMs?: number; pollMs?: number } = {},
): Promise<WorkflowState> {
  let state = await resolveTaskWorkflowState(taskId);
  if (transition.outputFile !== 'verify') return state;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + maxWaitMs;
  while (state?.workflowStatus === 'in_progress' && hasVerifyCompletionInFlight(taskId)) {
    if (Date.now() >= deadline) {
      log.warn(
        { taskId, maxWaitMs },
        '[verify-review-pending] Diff review still deciding past the wait limit — reading status as is',
      );
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    state = await resolveTaskWorkflowState(taskId);
  }
  return state;
}
