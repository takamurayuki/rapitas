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
import { reviewAndCommitWorktree } from './post-execution-review';

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
    log.info(`[API] Task ${taskIdNum} is waiting for user input, setting status to 'blocked'`);
    await prisma.task
      .update({
        where: { id: taskIdNum },
        data: { status: 'blocked' },
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
    // NOTE: Keep task as in_progress until the full pipeline
    // (AI review → commit → PR → cleanup) completes. Only then mark as done.
    await prisma.task
      .update({ where: { id: taskIdNum }, data: { status: 'in_progress' } })
      .catch((e: unknown) =>
        log.error({ err: e }, `[API] Failed to update task ${taskIdNum} to in_progress`),
      );
    log.info(`[API] Task ${taskIdNum} kept as in_progress (pending review pipeline)`);

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

    // Determine whether this execution belongs to a workflow phase. If so,
    // PR creation is the responsibility of `performAutoCommitAndPR` —
    // triggered when `verify.md` is saved at the end of the verifier phase.
    // Without this guard, the implementer phase finishes successfully and
    // would create the PR before the verifier had a chance to run, so the
    // user sees "PR created → 検証フェーズ" ordering.
    const session = await prisma.agentSession
      .findUnique({ where: { id: sessionId }, select: { mode: true } })
      .catch(() => null);
    const isWorkflowPhase = session?.mode?.startsWith('workflow-') === true;

    if (isWorkflowPhase) {
      log.info(
        { taskId: taskIdNum, mode: session?.mode },
        '[API] Workflow phase detected — skipping post-execution PR pipeline (verify.md handler will commit/PR after verification)',
      );
    } else {
      // Pipeline: AI review → commit → PR → cleanup → mark task done
      reviewAndCommitWorktree({
        taskId: taskIdNum,
        taskTitle,
        sessionId,
        workDir,
        executionDir,
        branchName,
        executionOutput: result.output,
      }).catch((err) => {
        log.warn({ err, taskId: taskIdNum }, '[API] Post-execution review pipeline failed');
      });
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
