/**
 * apply-task-status-from-workflow
 *
 * Maps a task's current workflowStatus to the coarse Task.status
 * ('in-progress' / 'done') shown in the execution log and task list. Shared by
 * every "a single agent run just finished successfully" epilogue
 * (continue-post-handler.ts, continuation-executor.ts) so the mapping stays
 * in one place instead of drifting between call sites.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('apply-task-status-from-workflow');

// workflowStatus values that mean "more phases remain" vs "nothing left to do".
const IN_PROGRESS_WORKFLOW_STATUSES = ['plan_created', 'research_done', 'verify_done'];
const DONE_WORKFLOW_STATUSES = ['in_progress', 'plan_approved', 'completed'];

/**
 * Minimal structural view of the Prisma client this helper needs. Accepted as
 * a parameter (rather than importing a module-level singleton) so callers on
 * either side of the postgres/sqlite dual-client split (ADR-0006) — and their
 * tests, which inject a mock `prisma` — all work without a hidden real DB
 * dependency.
 */
export interface TaskStatusPrismaClient {
  task: {
    findUnique: (args: {
      where: { id: number };
      select: { workflowStatus: true };
    }) => Promise<{ workflowStatus: string | null } | null>;
    update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

/**
 * Reads the task's current workflowStatus and sets Task.status to
 * 'in-progress' (more phases remain) or 'done' (nothing left — also stamps
 * completedAt). A workflowStatus of 'draft' or missing/unreadable also counts
 * as done, matching the pre-existing continue-execution behavior for a
 * single-shot run with no workflow phases at all. Failures are logged and
 * swallowed — this is a UI-consistency step, not a correctness gate (the
 * actual completion gate lives in the verify.md save path).
 *
 * @param prisma - Prisma client to use (injected — see TaskStatusPrismaClient). / 使用するPrismaクライアント
 * @param taskId - Task whose status should reflect its workflowStatus. / 対象タスク
 * @param logContext - Prefix for log lines (e.g. '[continue-execution]'). / ログ接頭辞
 */
export async function applyTaskStatusFromWorkflow(
  prisma: TaskStatusPrismaClient,
  taskId: number,
  logContext: string,
): Promise<void> {
  try {
    const currentTask = await prisma.task
      .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
      .catch(() => null);
    const wfStatus = currentTask?.workflowStatus;

    if (wfStatus && IN_PROGRESS_WORKFLOW_STATUSES.includes(wfStatus)) {
      await prisma.task.update({ where: { id: taskId }, data: { status: 'in-progress' } });
    } else if (wfStatus && DONE_WORKFLOW_STATUSES.includes(wfStatus)) {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'done', completedAt: new Date() },
      });
    } else if (!wfStatus || wfStatus === 'draft') {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'done', completedAt: new Date() },
      });
    }
  } catch (err) {
    log.error({ err, taskId }, `${logContext} Failed to apply task status from workflowStatus`);
  }
}
