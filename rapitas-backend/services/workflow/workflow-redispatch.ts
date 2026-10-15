/**
 * WorkflowRedispatch
 *
 * Shared one-shot delayed re-dispatch after a rollback (plan_invalid_replan /
 * phase-critic bounce): schedules a single advanceWorkflow call so a rolled-back
 * task is not stranded when the rollback happened outside the queue-driven loop
 * (task 546 sat 40 minutes at draft with no agent and no queue item). It is NOT
 * a retrying job queue — one setTimeout, fire-and-forget, same shape as the
 * existing one-shot advances in plan-auto-approve.ts / execute-post-handler.ts.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('workflow-redispatch');

/** Delay before the one-shot advance, so the rollback's status write commits first. */
export const REDISPATCH_DELAY_MS = 1000;

/**
 * Schedule a single delayed advanceWorkflow for a task that was just rolled
 * back. Never throws and never blocks the caller; duplicate-execution safety
 * comes from advanceWorkflow's own per-task execution lock (a concurrent
 * queue-loop advance simply makes this call return skipped).
 *
 * @param taskId - Task to re-dispatch. / 再ディスパッチ対象タスク
 * @param reason - Rollback cause, for the log line. / ロールバック理由（ログ用）
 * @param language - Agent output language. / エージェント出力言語
 */
export function scheduleWorkflowRedispatch(
  taskId: number,
  reason: string,
  language: 'ja' | 'en' = 'ja',
): void {
  setTimeout(() => {
    void (async () => {
      const { WorkflowOrchestrator } = await import('./workflow-orchestrator');
      const result = await WorkflowOrchestrator.getInstance().advanceWorkflow(taskId, language);
      log.info(
        { taskId, reason, success: result.success, error: result.error },
        '[workflow-redispatch] One-shot advance after rollback',
      );
    })().catch((err) => {
      log.error({ err, taskId, reason }, '[workflow-redispatch] Re-dispatch failed (non-fatal)');
    });
  }, REDISPATCH_DELAY_MS);
}
