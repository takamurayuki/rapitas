/**
 * execution/continue-post-handler
 *
 * Async post-execution handler for the continue-execution route.
 * Handles task/session status updates, code review approval creation,
 * and worktree cleanup after a continuation completes or fails.
 * Separated from continue-route.ts to keep each file under 300 lines.
 */

import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { updateSessionStatusWithRetry, createCodeReviewApproval } from './session-helpers';
import { releaseTaskExecutionLock } from './execution-lock';

const log = createLogger('routes:agent-execution:continue-post');
const agentWorkerManager = AgentWorkerManager.getInstance();

/** Shape of the result returned by agentWorkerManager.executeTask. */
interface ExecuteTaskResult {
  success: boolean;
  output?: string;
  errorMessage?: string;
  executionTimeMs?: number;
}

/** Parameters for handleContinueResult. */
export interface HandleContinueResultParams {
  result: ExecuteTaskResult;
  taskId: number;
  taskTitle: string;
  targetSessionId: number;
  configId?: number;
  branchName?: string | null;
  workingDirectory: string;
  executionDir: string;
}

/**
 * Handles the async result of a continuation execution: updates task/session
 * status, creates code review approval, and removes the worktree on success.
 *
 * @param params - Continuation context and result / 継続実行コンテキストと結果
 */
export async function handleContinueResult(params: HandleContinueResultParams): Promise<void> {
  const {
    result,
    taskId,
    taskTitle,
    targetSessionId,
    configId,
    branchName,
    workingDirectory,
    executionDir,
  } = params;

  if (result.success) {
    try {
      const currentTask = await prisma.task.findUnique({ where: { id: taskId } });
      const wfStatus = currentTask?.workflowStatus;
      const inProgressStatuses = ['plan_created', 'research_done', 'verify_done'];
      const doneStatuses = ['in_progress', 'plan_approved', 'completed'];

      if (wfStatus && inProgressStatuses.includes(wfStatus)) {
        await prisma.task
          .update({ where: { id: taskId }, data: { status: 'in-progress' } })
          .catch((e: unknown) =>
            log.error(
              { err: e },
              `[continue-execution] Failed to update task ${taskId} to in-progress`,
            ),
          );
      } else if (wfStatus && doneStatuses.includes(wfStatus)) {
        await prisma.task
          .update({ where: { id: taskId }, data: { status: 'done', completedAt: new Date() } })
          .catch((e: unknown) =>
            log.error({ err: e }, `[continue-execution] Failed to update task ${taskId} to done`),
          );
      } else if (!wfStatus || wfStatus === 'draft') {
        await prisma.task
          .update({ where: { id: taskId }, data: { status: 'done', completedAt: new Date() } })
          .catch((e: unknown) =>
            log.error({ err: e }, `[continue-execution] Failed to update task ${taskId} to done`),
          );
      }
    } catch (taskError) {
      log.error({ err: taskError }, `[continue-execution] Failed to update task ${taskId}`);
    }

    await updateSessionStatusWithRetry(targetSessionId, 'completed', '[continue-execution]', 3);

    if (configId) {
      await createCodeReviewApproval({
        taskId,
        taskTitle,
        configId,
        sessionId: targetSessionId,
        workDir: executionDir,
        branchName: branchName || undefined,
        resultOutput: result.output,
        executionTimeMs: result.executionTimeMs,
        logPrefix: '[continue-execution]',
      });
    }

    // NOTE: Clean up worktree after successful continued execution
    if (executionDir !== workingDirectory) {
      try {
        await agentWorkerManager.removeWorktree(workingDirectory, executionDir);
        await prisma.agentSession.update({
          where: { id: targetSessionId },
          data: { worktreePath: null },
        });
        log.info(`[continue-execution] Cleaned up worktree for task ${taskId}`);
      } catch (cleanupErr) {
        log.warn(
          { err: cleanupErr },
          `[continue-execution] Worktree cleanup failed for task ${taskId}`,
        );
      }
    }

    log.info(`[continue-execution] Completed task ${taskId}`);
  } else {
    log.error(
      { errorMessage: result.errorMessage },
      `[continue-execution] Failed for task ${taskId}`,
    );
    await prisma.task
      .update({ where: { id: taskId }, data: { status: 'todo' } })
      .catch((e: unknown) =>
        log.error(
          { err: e },
          `[continue-execution] Failed to update task ${taskId} to todo after failure`,
        ),
      );

    await prisma.agentSession
      .update({
        where: { id: targetSessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: result.errorMessage || 'Continuation failed',
        },
      })
      .catch((e: unknown) =>
        log.error(
          { err: e },
          `[continue-execution] Failed to update session ${targetSessionId} to failed`,
        ),
      );
  }
}

/**
 * Handles a fatal error from the continuation execution promise.
 *
 * @param error - The thrown error / スローされたエラー
 * @param taskId - Task ID to reset / リセット対象タスクID
 * @param targetSessionId - Session to mark failed / 失敗マーク対象セッションID
 */
export async function handleContinueError(
  error: Error,
  taskId: number,
  targetSessionId: number,
): Promise<void> {
  log.error({ err: error }, `[continue-execution] Execution error for task ${taskId}`);
  await prisma.task
    .update({ where: { id: taskId }, data: { status: 'todo' } })
    .catch((e: unknown) =>
      log.error(
        { err: e },
        `[continue-execution] Failed to update task ${taskId} to todo after error`,
      ),
    );

  await prisma.agentSession
    .update({
      where: { id: targetSessionId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error.message || 'Continuation error',
      },
    })
    .catch((e: unknown) =>
      log.error(
        { err: e },
        `[continue-execution] Failed to update session ${targetSessionId} to failed`,
      ),
    );

  releaseTaskExecutionLock(taskId);
}
