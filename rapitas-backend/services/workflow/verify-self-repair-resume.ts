/**
 * verify-self-repair-resume
 *
 * Handles self-driving the WorkflowRunner after a verify→implement bounce, and
 * telemetry identification of the bounce's caller. Not responsible for
 * repair-budget judgement or feedback generation.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:verify-self-repair');

/**
 * Call sites of `attemptVerifyRepair`, for repair-budget telemetry only
 * (task 749) — never used for control flow. A path not matching any entry
 * resolves to 'unknown'.
 */
const REPAIR_CALLER_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['file-save/status-transition', 'http_save'],
  ['file-save/verify-adversarial-review', 'adversarial_review'],
  ['file-save/verify-commit-pr-gate-blocked', 'commit_pr_gate'],
  ['workflow-api-executor', 'api_executor'],
  ['workflow-cli-executor-verify-gate', 'cli_epilogue'],
];

/**
 * Best-effort caller attribution from the call stack — telemetry only, so
 * next time this task's budget is exceeded (task#603/#710) the recorded
 * transition metadata identifies which of the several call sites raced.
 *
 * @returns A known caller label, or 'unknown'. / 呼び出し元識別子
 */
export function resolveRepairCaller(): string {
  const stack = new Error().stack ?? '';
  for (const [needle, label] of REPAIR_CALLER_LABELS) if (stack.includes(needle)) return label;
  return 'unknown';
}

/**
 * Re-queue + ensure the WorkflowRunner is processing, so implement→verify
 * re-runs for a SINGLE/MANUAL execution with no poller.
 *
 * Skips when the theme has ACTIVE auto-run: that scheduler already
 * re-enqueues its task (with themeId, visible to the concurrency gate).
 * Enqueuing here too would add a themeId-LESS item the gate can't see,
 * letting the scheduler launch a second task concurrently. Idempotent
 * (duplicate enqueue throws, swallowed); the per-task mutex prevents a
 * duplicate agent.
 *
 * @param taskId - Task to resume / 再開対象タスク
 */
export async function ensureRunnerResumes(taskId: number): Promise<void> {
  // Defer to the theme auto-run scheduler when it owns this task.
  try {
    const task = await prisma.task
      .findUnique({ where: { id: taskId }, select: { themeId: true } })
      .catch(() => null);
    const { isThemeAutoRunActive } = await import('./auto-run/theme-auto-run-service');
    if (await isThemeAutoRunActive(task?.themeId ?? null)) {
      log.info(
        { taskId, themeId: task?.themeId },
        '[verify-repair] Theme auto-run is active — letting the scheduler resume (no extra enqueue)',
      );
      return;
    }
  } catch (err) {
    // If we cannot determine auto-run state, fall through and self-drive — a
    // stuck single-exec task is worse than a redundant (deduped) enqueue.
    log.warn({ err, taskId }, '[verify-repair] Could not check theme auto-run state');
  }

  const { WorkflowQueueService } = await import('./workflow-queue');
  const { WorkflowRunner } = await import('./workflow-runner');
  try {
    await WorkflowQueueService.getInstance().enqueue({ taskId });
  } catch {
    // Already queued/running — a driver is active; nothing to enqueue.
  }
  WorkflowRunner.getInstance().startProcessing(); // idempotent (guarded by `running`)
}
