/**
 * mark-latest-execution-failed
 *
 * Aligns a task's latest agent execution (and its session) to `failed` when a
 * verify is rejected, so the execution log never shows 「完了」 for a blocked task.
 * Not responsible for blocking the task or recording the transition itself.
 *
 * NOTE: Moved down from routes/workflow/handlers/file-save/shared.ts — services
 * (review-hold-resolve, verify-fallback-jury-gate) need it and must not import
 * routes (import-graph rule services-must-not-import-routes). shared.ts
 * re-exports it so the file-save pipeline keeps its import path.
 */
// NOTE: The config barrel, not config/database — kept from the original so the
// file-save tests that mock only '../config' still intercept this prisma.
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import { NOT_REVIEW_COST_ROW } from '../../agents/review-cost-rows';

const log = createLogger('routes:workflow:handlers:files');

/**
 * Marks a task's latest agent execution (and session) failed with a reason.
 *
 * When a verify is rejected (validation or the automated gate) the task is set
 * `blocked`, but the agent's execution row stays `completed` — so the execution
 * log viewer shows 「完了」 while the task is blocked (the confusing status gap).
 * Aligning the execution/session to `failed` closes that gap. Never throws.
 *
 * @param taskId - Task whose latest execution to fail / 対象タスク
 * @param message - Failure reason shown in the viewer / 失敗理由
 */
export async function markLatestExecutionFailed(taskId: number, message: string): Promise<void> {
  try {
    const session = await prisma.agentSession.findFirst({
      where: { config: { taskId } },
      orderBy: { createdAt: 'desc' },
      include: {
        agentExecutions: { where: NOT_REVIEW_COST_ROW, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!session) return;
    const exec = session.agentExecutions[0];
    if (exec && exec.status !== 'failed') {
      await prisma.agentExecution
        .update({
          where: { id: exec.id },
          data: { status: 'failed', errorMessage: message, completedAt: new Date() },
        })
        .catch(() => {});
    }
    if (session.status !== 'failed') {
      await prisma.agentSession
        .update({ where: { id: session.id }, data: { status: 'failed', errorMessage: message } })
        .catch(() => {});
    }
  } catch (err) {
    log.warn({ err, taskId }, '[Workflow] Failed to mark latest execution failed');
  }
}
