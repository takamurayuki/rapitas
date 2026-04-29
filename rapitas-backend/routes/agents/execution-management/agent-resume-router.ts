/**
 * Agent Resume Router
 *
 * Handles acknowledgement and resumption of interrupted executions,
 * and provides the list of currently-running tasks for the real-time panel.
 * Async post-resume completion logic is delegated to agent-resume-handlers.ts.
 */

import { Elysia } from 'elysia';
import { join } from 'path';
import { prisma, getProjectRoot } from '../../../config';
import { createLogger } from '../../../config/logger';
import { toJsonString } from '../../../utils/database/db-helpers';
// NOTE: Parallel execution mechanism was removed. Sub-tasks now resume
// through the same single-task path as the parent — they're picked up
// by the regular workflow advance loop in workflow-orchestrator.
import { handleResumeCompletion } from './agent-resume-handlers';

const log = createLogger('routes:agent-resume');

export const agentResumeRouter = new Elysia()

  // Mark interrupted execution as acknowledged (clears it from the interrupted list)
  .post('/agents/executions/:id/acknowledge', async (context) => {
    const { params } = context;
    const executionId = parseInt(params.id);

    const execution = await prisma.agentExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      return { success: false, error: 'Execution not found' };
    }

    if (execution.status !== 'interrupted') {
      return { success: false, error: 'Execution is not interrupted' };
    }

    await prisma.agentExecution.update({
      where: { id: executionId },
      data: { status: 'acknowledged', completedAt: new Date() },
    });

    return { success: true, message: 'Execution acknowledged' };
  })

  // Resume interrupted execution
  .post('/agents/executions/:id/resume', async (context) => {
    const params = context.params as { id: string };
    const body = context.body as { timeout?: number } | undefined;
    const executionId = parseInt(params.id);

    try {
      const execution = await prisma.agentExecution.findUnique({
        where: { id: executionId },
        include: {
          session: {
            include: {
              config: {
                include: {
                  task: {
                    select: {
                      id: true,
                      title: true,
                      description: true,
                      theme: {
                        select: { name: true, workingDirectory: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!execution) {
        return { success: false, error: 'Execution not found' };
      }

      if (execution.status !== 'interrupted') {
        return {
          success: false,
          error: `Cannot resume execution with status: ${execution.status}`,
        };
      }

      const task = execution.session.config?.task;
      if (!task) {
        return { success: false, error: 'Task not found for this execution' };
      }

      // CRITICAL: Require explicit workingDirectory to prevent accidental modification of rapitas source
      const workingDirectory = task.theme?.workingDirectory;
      if (!workingDirectory) {
        log.warn(
          `[resume] Task ${task.id} rejected: workingDirectory not configured for theme "${task.theme?.name || 'unknown'}".`,
        );
        return {
          success: false,
          error:
            'Task theme must have workingDirectory configured. Please set the working directory in theme settings to prevent accidental modification of rapitas source code.',
        };
      }

      // NOTE: Log warning when workingDirectory overlaps with rapitas project — allowed but flagged
      const projectRoot = getProjectRoot();
      if (
        workingDirectory === projectRoot ||
        workingDirectory.startsWith(join(projectRoot, 'rapitas-'))
      ) {
        log.warn(
          `[resume] Task ${task.id}: workingDirectory overlaps with rapitas project (${workingDirectory}). Proceeding.`,
        );
      }

      // Check for in-progress subtasks
      const subtasks = await prisma.task.findMany({
        where: { parentId: task.id, status: 'in-progress' },
        orderBy: { id: 'asc' },
      });

      const hasSubtasks = subtasks.length > 0;
      log.info(`[resume] Task ${task.id} has ${subtasks.length} in-progress subtasks`);

      await prisma.notification.create({
        data: {
          type: 'agent_execution_resumed',
          title: 'エージェント実行再開',
          message: `「${task.title}」の中断された作業を再開しています${hasSubtasks ? `（進行中のサブタスク${subtasks.length}件を並列実行）` : ''}`,
          link: `/tasks/${task.id}`,
          metadata: toJsonString({
            executionId,
            sessionId: execution.sessionId,
            taskId: task.id,
            parallelExecution: hasSubtasks,
          }),
        },
      });

      // Subtask resume (parallel-execution mechanism removed): the parent
      // task is the unit of resume. Each subtask is just a child Task and
      // gets advanced through its own workflow when the user later kicks
      // off advance on it. Surface a notification so the user knows there
      // are interrupted subtasks waiting.
      if (hasSubtasks) {
        log.info(
          `[resume] Parent task ${task.id} has ${subtasks.length} in-progress subtask(s); they will resume on their own workflow advance.`,
        );
        await prisma.notification
          .create({
            data: {
              type: 'agent_execution_resumed',
              title: 'サブタスクが残っています',
              message: `「${task.title}」配下にまだ進行中のサブタスクが${subtasks.length}件あります。各サブタスクのワークフローを進めてください。`,
              link: `/tasks/${task.id}`,
            },
          })
          .catch(() => {});
      }

      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'in-progress', startedAt: new Date() },
      });
      log.info(`[resume] Updated task ${task.id} status to 'in-progress'`);

      // Fire-and-forget: run the resume asynchronously and let handleResumeCompletion
      // manage all post-completion state updates and notifications
      handleResumeCompletion(
        executionId,
        { sessionId: execution.sessionId, session: { config: execution.session.config } },
        task,
        workingDirectory,
        body?.timeout || 900000,
      );

      return {
        success: true,
        executionId,
        taskId: task.id,
        taskTitle: task.title,
        message: '中断された実行を再開しています。進捗はリアルタイムで確認できます。',
      };
    } catch (error) {
      log.error({ err: error }, '[resume] Error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resume execution',
      };
    }
  })

  // Get all currently executing tasks (for real-time panel display)
  .get('/tasks/executing', async () => {
    try {
      const executingTasks = await prisma.agentExecution.findMany({
        where: {
          status: { in: ['running', 'waiting_for_input'] },
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          session: {
            select: {
              id: true,
              config: { select: { taskId: true } },
            },
          },
        },
        orderBy: { startedAt: 'desc' },
      });

      return executingTasks.map((execution: (typeof executingTasks)[number]) => ({
        executionId: execution.id,
        sessionId: execution.session.id,
        taskId: execution.session.config.taskId,
        executionStatus: execution.status,
        startedAt: execution.startedAt,
      }));
    } catch (error) {
      const errObj = error as { code?: string; message?: string };
      if (errObj?.code === 'P1001') {
        log.warn('[executing-tasks] Database unreachable, skipping');
      } else {
        log.error({ err: error }, '[executing-tasks] Error');
      }
      return [];
    }
  });
