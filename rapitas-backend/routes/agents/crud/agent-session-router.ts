import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:agent-session');
import { orchestrator } from '../../../services/core/orchestrator-instance';
import type { AgentExecutionWithExtras } from '../../../types/agent-execution-types';

/**
 * Agent Session Management Router
 *
 * Handles session detail retrieval, stopping, and resumable execution management.
 */
export const agentSessionRouter = new Elysia({ prefix: '/agents' })

  // Get session details
  .get('/sessions/:id', async (context) => {
    const { params } = context;
    return await prisma.agentSession.findUnique({
      where: { id: parseInt(params.id) },
      include: {
        agentActions: { orderBy: { createdAt: 'desc' } },
        agentExecutions: {
          include: {
            agentConfig: true,
            gitCommits: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  })

  // Stop session
  .post('/sessions/:id/stop', async (context) => {
    const { params } = context;
    const sessionId = parseInt(params.id);

    // Attempt to stop via orchestrator
    // Asynchronously get and stop executions within the session via the worker process
    try {
      const { AgentWorkerManager } = await import('../../../services/agents/agent-worker-manager');
      const executions =
        await AgentWorkerManager.getInstance().getSessionExecutionsAsync(sessionId);
      for (const execution of executions) {
        await orchestrator.stopExecution(execution.executionId).catch((err) => {
          log.warn(
            { err, executionId: execution.executionId },
            'Failed to stop execution during session termination',
          );
        });
      }
    } catch (err) {
      log.warn({ err }, 'Failed to get session executions from worker');
    }

    // Cancel all running/pending executions in the database
    await prisma.agentExecution.updateMany({
      where: {
        sessionId,
        status: { in: ['running', 'pending', 'waiting_for_input'] },
      },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: 'Manually stopped',
      },
    });

    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: 'Manually stopped',
      },
    });

    // NOTE: Reset task status to 'todo' so it doesn't stay in 'in-progress' or 'waiting' state
    try {
      const sessionWithConfig = await prisma.agentSession.findUnique({
        where: { id: sessionId },
        include: { config: { select: { taskId: true } } },
      });
      if (sessionWithConfig?.config?.taskId) {
        await prisma.task.update({
          where: { id: sessionWithConfig.config.taskId },
          data: { status: 'todo' },
        });
        log.info(`[session-stop] Reset task ${sessionWithConfig.config.taskId} status to 'todo'`);
      }
    } catch (taskErr) {
      log.warn({ err: taskErr }, '[session-stop] Failed to reset task status');
    }

    return { success: true };
  })

  // Get resumable executions (interrupted or stale running)
  // This handles both intentionally interrupted executions and ones left in "running" state after server restart
  .get('/resumable-executions', async () => {
    try {
      // Stale execution recovery is handled at startup by orchestrator.recoverStaleExecutions()
      // This endpoint only reads data — no recovery logic here to avoid race conditions
      // with newly created executions that haven't been added to activeExecutions yet.

      // NOTE: orchestrator.getActiveExecutions() (sync) always returns empty due to worker process isolation.
      // Use the async version to retrieve actual active execution IDs from the worker.
      const workerManager = orchestrator as unknown as {
        getActiveExecutionIdsAsync?: () => Promise<number[]>;
      };
      const workerActiveIds = workerManager.getActiveExecutionIdsAsync
        ? await workerManager.getActiveExecutionIdsAsync()
        : orchestrator.getActiveExecutions().map((e: { executionId: number }) => e.executionId);

      // Workflow / auto-run agents run in the MAIN-process AgentOrchestrator
      // (workflow-cli-executor calls AgentOrchestrator.getInstance directly),
      // NOT the worker — so the worker's active-id list above misses them and
      // the running banner never appeared during auto-execution. Union both so
      // every live execution (manual via worker + auto-run via main) is shown.
      const { AgentOrchestrator } = await import('../../../services/agents/agent-orchestrator');
      const mainActiveIds = AgentOrchestrator.getInstance(prisma)
        .getActiveAgentInfos()
        .map((i) => i.executionId);
      const currentActiveIds = Array.from(new Set([...workerActiveIds, ...mainActiveIds]));

      const resumableExecutions = await prisma.agentExecution.findMany({
        where: {
          OR: [
            // Interrupted executions (resumable)
            { status: 'interrupted' },
            // Only executions actually active in memory
            {
              status: { in: ['running', 'waiting_for_input'] },
              id: { in: currentActiveIds.length > 0 ? currentActiveIds : [-1] },
            },
          ],
        },
        include: {
          session: {
            include: {
              config: {
                include: {
                  task: {
                    select: {
                      id: true,
                      title: true,
                      status: true,
                      theme: {
                        select: {
                          workingDirectory: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      // Dedupe per task: a task with a LIVE (running / waiting) execution must not
      // also surface its OLD `interrupted` execution. That interrupted row is a
      // stale leftover (a restart or a phase rollover left it behind while the
      // workflow re-dispatched a fresh execution), and showing both makes ONE task
      // appear TWICE in the "in-progress work" modal — one 実行中 and one 中断, which
      // is exactly what the user reported for task 284. Keep the live one; drop the
      // task's interrupted rows when a live execution exists.
      const liveTaskIds = new Set(
        resumableExecutions
          .filter((e) => e.status === 'running' || e.status === 'waiting_for_input')
          .map((e) => e.session.config?.task?.id)
          .filter((id): id is number => id != null),
      );
      // A done/completed/cancelled task's `interrupted` row is NOT resumable work —
      // it is a stale leftover that lingered in the "中断作業" modal after the task
      // finished (task 284 completed via a fresh execution but its earlier
      // interrupted row stayed). Drop those too.
      const TERMINAL_TASK_STATUS = new Set(['done', 'completed', 'cancelled']);
      const dedupedExecutions = resumableExecutions.filter((e) => {
        if (e.status !== 'interrupted') return true;
        const task = e.session.config?.task;
        if (liveTaskIds.has(task?.id ?? -1)) return false;
        if (task?.status && TERMINAL_TASK_STATUS.has(task.status)) return false;
        return true;
      });

      return dedupedExecutions.map((exec: (typeof resumableExecutions)[number]) => {
        const execWithExtras = exec as typeof exec & AgentExecutionWithExtras;
        return {
          id: exec.id,
          taskId: exec.session.config?.task?.id,
          taskTitle: exec.session.config?.task?.title,
          sessionId: exec.sessionId,
          status: exec.status,
          claudeSessionId: execWithExtras.claudeSessionId,
          errorMessage: exec.errorMessage,
          output: exec.output?.slice(-500), // Last 500 characters only
          startedAt: exec.startedAt,
          completedAt: exec.completedAt,
          createdAt: exec.createdAt,
          workingDirectory: exec.session.config?.task?.theme?.workingDirectory,
          canResume: exec.status === 'interrupted', // Only interrupted can be resumed
        };
      });
    } catch (error) {
      const errObj = error as { code?: string; message?: string };
      if (errObj?.code === 'P1001') {
        log.warn('[resumable-executions] Database unreachable, skipping');
      } else {
        log.error({ err: error }, '[resumable-executions] Error');
      }
      return [];
    }
  })

  // Legacy endpoint for backwards compatibility
  .get('/interrupted-executions', async () => {
    try {
      const interruptedExecutions = await prisma.agentExecution.findMany({
        where: {
          status: 'interrupted',
        },
        include: {
          session: {
            include: {
              config: {
                include: {
                  task: {
                    select: {
                      id: true,
                      title: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return interruptedExecutions.map((exec: (typeof interruptedExecutions)[number]) => {
        const execWithExtras = exec as typeof exec & AgentExecutionWithExtras;
        return {
          id: exec.id,
          taskId: exec.session.config?.task?.id,
          taskTitle: exec.session.config?.task?.title,
          sessionId: exec.sessionId,
          status: exec.status,
          claudeSessionId: execWithExtras.claudeSessionId,
          errorMessage: exec.errorMessage,
          output: exec.output?.slice(-500), // Last 500 characters only
          startedAt: exec.startedAt,
          completedAt: exec.completedAt,
          createdAt: exec.createdAt,
          canResume: !!execWithExtras.claudeSessionId, // Resumable if Claude Session ID exists
        };
      });
    } catch (error) {
      log.error({ err: error }, '[interrupted-executions] Error');
      return [];
    }
  });
