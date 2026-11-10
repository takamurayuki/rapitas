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
import { isCertainlySingleShotRun, type FinishedRunInfo } from './finished-run-kind';

const log = createLogger('apply-task-status-from-workflow');

// workflowStatus values that mean "more phases remain" vs "nothing left to do".
// NOTE: in_progress / plan_approved used to map to done (with completedAt).
// Both precede the verify phase, so an unverified task read as done — and
// subtask success (status === 'done') could count it (G2 routing1 re-review 5).
const IN_PROGRESS_WORKFLOW_STATUSES = [
  'plan_created',
  'research_done',
  'verify_done',
  'in_progress',
  'plan_approved',
];

// NOTE: mayBeWorkflowRun was removed — it called a null mode single-shot, but a
// workflow phase whose session-mode write failed also reads back null (G2
// routing1 re-review 7). finished-run-kind.ts now decides, from the task's
// workflow-disabled setting.
export type { FinishedRunInfo };

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
      select: { workflowStatus: true; status: true };
    }) => Promise<{ workflowStatus: string | null; status?: string | null } | null>;
    update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

/**
 * Reads the task's current workflowStatus and sets Task.status to
 * 'in-progress' (more phases remain, including the verify phase after
 * in_progress / plan_approved) or 'done' (also stamps completedAt).
 *  - completed: done — the workflow already passed its completion gate; this
 *    only aligns Task.status.
 *  - draft or null after a run that is certainly single-shot (the workflow is
 *    disabled for the task — see isCertainlySingleShotRun): done only when
 *    the shared completion check (verifierConfirmedForCompletion) allows it;
 *    otherwise the status is left alone.
 *  - draft or null after any other run (workflow phase, mode null or
 *    unknown): left alone — the workflow has not reached verify.
 * Failures are logged and swallowed; a failed read or check never marks done.
 *
 * @param prisma - Prisma client to use (injected — see TaskStatusPrismaClient). / 使用するPrismaクライアント
 * @param taskId - Task whose status should reflect its workflowStatus. / 対象タスク
 * @param logContext - Prefix for log lines (e.g. '[continue-execution]'). / ログ接頭辞
 * @param run - The finished run's session mode (see FinishedRunInfo). / 終了した実行の種別
 */
export async function applyTaskStatusFromWorkflow(
  prisma: TaskStatusPrismaClient,
  taskId: number,
  logContext: string,
  run: FinishedRunInfo,
): Promise<void> {
  try {
    // NOTE: A FAILED read must not be conflated with "this task has no
    // workflowStatus". Both used to collapse into `null` via `.catch(() => null)`
    // and fall through to the `!wfStatus` branch below, which marks the task
    // DONE and stamps completedAt. Observed on task 632: the backend restarted
    // while this epilogue ran, the read failed against the closing connection,
    // and a task whose adversarial review had REJECTED it was silently recorded
    // as complete (done / verify_done, no transition logged). A read we could
    // not perform tells us nothing — leave the status alone.
    let currentTask: { workflowStatus: string | null; status?: string | null } | null;
    try {
      currentTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { workflowStatus: true, status: true },
      });
    } catch (err) {
      log.warn(
        { err, taskId },
        `${logContext} Could not read workflowStatus — leaving task status unchanged`,
      );
      return;
    }
    // Row genuinely absent: there is nothing to update (and the update would
    // throw). Distinct from an existing row whose workflowStatus is null, which
    // legitimately means "single-shot run, no workflow phases" → done.
    if (!currentTask) return;
    // An operator cancel that landed while this phase was still running must
    // survive the phase finishing: writing 'in-progress' here revived #1079 and
    // #1087 (2026-09-25) and the runner then dispatched their next phase.
    if (currentTask.status === 'cancelled' || currentTask.status === 'archived') {
      log.info(
        { taskId, status: currentTask.status },
        `${logContext} Task was withdrawn mid-run — leaving status unchanged`,
      );
      return;
    }
    const wfStatus = currentTask.workflowStatus;

    if (wfStatus && IN_PROGRESS_WORKFLOW_STATUSES.includes(wfStatus)) {
      await prisma.task.update({ where: { id: taskId }, data: { status: 'in-progress' } });
    } else if (wfStatus === 'completed') {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'done', completedAt: new Date() },
      });
    } else if (!wfStatus || wfStatus === 'draft') {
      // NOTE: A workflow run leaves draft before verify, and with no verifier
      // run the shared check allows (no_verifier_run) — so a workflow task in
      // draft used to be marked done unverified (G2 routing1 re-review 6).
      if (!(await isCertainlySingleShotRun(taskId, run.sessionMode))) {
        log.info(
          { taskId, workflowStatus: wfStatus, sessionMode: run.sessionMode ?? 'unknown' },
          `${logContext} Run is not certainly single-shot and left the task in draft — not marking done`,
        );
        return;
      }
      const { verifierConfirmedForCompletion } = await import('./verifier-completion-check');
      if (!(await verifierConfirmedForCompletion(taskId, 'status_sync'))) {
        log.warn(
          { taskId },
          `${logContext} Completion check refused — leaving task status unchanged`,
        );
        return;
      }
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'done', completedAt: new Date() },
      });
    }
  } catch (err) {
    log.error({ err, taskId }, `${logContext} Failed to apply task status from workflowStatus`);
  }
}
