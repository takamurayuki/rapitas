/**
 * execution/execute-post-handler
 *
 * Async post-execution handler called inside the `.then()` block after the
 * agent worker resolves. Handles task/session status updates, code review
 * approval creation, and worktree cleanup.
 * Separated from execute-route.ts to keep each file under 300 lines.
 */

import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { updateSessionStatusWithRetry, createCodeReviewApproval } from './session-helpers';

const log = createLogger('routes:agent-execution:post-handler');
const agentWorkerManager = AgentWorkerManager.getInstance();

/** Shape of the result returned by agentWorkerManager.executeTask. */
interface ExecuteTaskResult {
  success: boolean;
  waitingForInput?: boolean;
  output?: string;
  errorMessage?: string;
  executionTimeMs?: number;
}

/** Parameters passed to handleExecuteResult. */
export interface HandleExecuteResultParams {
  result: ExecuteTaskResult;
  taskIdNum: number;
  sessionId: number;
  configId: number;
  taskTitle: string;
  workDir: string;
  executionDir: string;
  branchName?: string;
}

/**
 * Handles the async result of a task execution: updates task/session status,
 * creates code review approval, and removes the worktree on success.
 *
 * @param params - Execution context and result / 実行コンテキストと結果
 */
export async function handleExecuteResult(params: HandleExecuteResultParams): Promise<void> {
  const { result, taskIdNum, sessionId, configId, taskTitle, workDir, executionDir, branchName } =
    params;

  if (result.waitingForInput) {
    log.info(`[API] Task ${taskIdNum} is waiting for user input, keeping status as 'in_progress'`);
    await prisma.task
      .update({
        where: { id: taskIdNum },
        data: { status: 'in_progress' },
      })
      .catch((e: unknown) => {
        log.error({ err: e }, `[API] Failed to update task ${taskIdNum} status to in_progress`);
      });

    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: { status: 'running', lastActivityAt: new Date() },
      })
      .catch((e: unknown) => {
        log.error({ err: e }, `[API] Failed to update session ${sessionId} status to running`);
      });
    return;
  }

  if (result.success) {
    try {
      const currentTask = await prisma.task.findUnique({ where: { id: taskIdNum } });
      const wfStatus = currentTask?.workflowStatus;
      const inProgressStatuses = ['plan_created', 'research_done', 'verify_done'];
      const doneStatuses = ['in_progress', 'plan_approved', 'completed'];

      if (wfStatus && inProgressStatuses.includes(wfStatus)) {
        await prisma.task
          .update({ where: { id: taskIdNum }, data: { status: 'in-progress' } })
          .catch((e: unknown) =>
            log.error({ err: e }, `[API] Failed to update task ${taskIdNum} to in-progress`),
          );
        log.info(`[API] Task ${taskIdNum} kept as in-progress (workflow: ${wfStatus})`);
      } else if (wfStatus && doneStatuses.includes(wfStatus)) {
        await prisma.task
          .update({ where: { id: taskIdNum }, data: { status: 'done', completedAt: new Date() } })
          .catch((e: unknown) =>
            log.error({ err: e }, `[API] Failed to update task ${taskIdNum} to done`),
          );
        log.info(`[API] Updated task ${taskIdNum} status to 'done' (workflow: ${wfStatus})`);
      } else if (!wfStatus || wfStatus === 'draft') {
        await prisma.task
          .update({ where: { id: taskIdNum }, data: { status: 'done', completedAt: new Date() } })
          .catch((e: unknown) =>
            log.error({ err: e }, `[API] Failed to update task ${taskIdNum} to done`),
          );
        log.info(`[API] Updated task ${taskIdNum} status to 'done'`);
      } else {
        log.info(`[API] Task ${taskIdNum} kept as in-progress (unknown workflow: ${wfStatus})`);
      }
    } catch (taskError) {
      log.error({ err: taskError }, `[API] Failed to fetch or update task ${taskIdNum}`);
    }

    await updateSessionStatusWithRetry(sessionId, 'completed', '[API]', 3);

    await createCodeReviewApproval({
      taskId: taskIdNum,
      taskTitle,
      configId,
      sessionId,
      workDir: executionDir,
      branchName,
      resultOutput: result.output,
      executionTimeMs: result.executionTimeMs,
      logPrefix: '[API]',
    });

    // NOTE: Clean up worktree after successful execution (branch is pushed to remote)
    try {
      await agentWorkerManager.removeWorktree(workDir, executionDir);
      await prisma.agentSession.update({
        where: { id: sessionId },
        data: { worktreePath: null },
      });
      log.info(`[API] Cleaned up worktree for task ${taskIdNum}`);
    } catch (cleanupErr) {
      log.warn({ err: cleanupErr }, `[API] Worktree cleanup failed for task ${taskIdNum}`);
    }
  } else {
    log.error(
      { errorMessage: result.errorMessage },
      `[API] Execution failed for task ${taskIdNum}`,
    );
    await prisma.task
      .update({ where: { id: taskIdNum }, data: { status: 'todo' } })
      .catch((e: unknown) =>
        log.error({ err: e }, `[API] Failed to update task ${taskIdNum} to todo after failure`),
      );

    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: result.errorMessage || 'Execution failed',
        },
      })
      .catch((e: unknown) =>
        log.error({ err: e }, `[API] Failed to update session ${sessionId} to failed`),
      );
  }
}
