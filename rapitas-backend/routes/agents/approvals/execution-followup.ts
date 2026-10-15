/**
 * Approvals — ExecutionFollowup
 *
 * Fire-and-forget execution of an approved task_execution request and the
 * completion/error notifications that follow it.
 * Not responsible for the approval status transition or HTTP concerns.
 */

import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { orchestrator } from '../../../services/core/orchestrator-instance';
import { toJsonString } from '../../../utils/database/db-helpers';
import { isShutdownError } from '../../../services/agents/agent-worker/shutdown-error';

const log = createLogger('routes:approvals:execution-followup');

interface FollowupTask {
  id: number;
  title: string;
  description: string | null;
  executionInstructions: string | null;
}

/**
 * Start the orchestrator for an approved task and persist result notifications.
 *
 * @param task - Task to execute / 実行対象タスク
 * @param sessionId - AgentSession created for this run / セッションID
 * @param agentConfigId - Resolved agent config, if any / 解決済みエージェント設定
 * @param workingDirectory - Working directory from proposedChanges / 作業ディレクトリ
 */
export function startApprovedTaskExecution(
  task: FollowupTask,
  sessionId: number,
  agentConfigId: number | undefined,
  workingDirectory: string | undefined,
): void {
  orchestrator
    .executeTask(
      {
        id: task.id,
        title: task.title,
        description: task.description,
        context: task.executionInstructions || undefined,
        workingDirectory,
      },
      { taskId: task.id, sessionId, agentConfigId, workingDirectory },
    )
    .then(async (result) => {
      await prisma.notification.create({
        data: {
          type: 'agent_execution_complete',
          title: result.success ? 'Agent Execution Complete' : 'Agent Execution Failed',
          message: result.success
            ? `Automatic execution of "${task.title}" completed successfully`
            : `Automatic execution of "${task.title}" failed: ${result.errorMessage}`,
          link: `/tasks/${task.id}`,
          metadata: toJsonString({ sessionId, taskId: task.id, success: result.success }),
        },
      });

      if (result.success) {
        await prisma.task.update({
          where: { id: task.id },
          data: { status: 'done', completedAt: new Date() },
        });
      }
    })
    .catch(async (error) => {
      if (isShutdownError(error)) {
        // NOTE: Shutdown-originated reject is not a failure — demote to WARN
        // and skip the error notification to avoid false "Agent Execution Error" noise.
        log.warn({ err: error }, 'Agent execution interrupted by shutdown');
        return;
      }
      log.error({ err: error }, 'Agent execution failed');
      await prisma.notification.create({
        data: {
          type: 'agent_error',
          title: 'Agent Execution Error',
          message: `An error occurred during execution of "${task.title}"`,
          link: `/tasks/${task.id}`,
        },
      });
    });
}
