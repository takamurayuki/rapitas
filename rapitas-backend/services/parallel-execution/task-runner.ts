/**
 * ParallelExecution — TaskRunner
 *
 * Executes individual tasks within a parallel session: creates worktrees,
 * manages AgentExecution DB records, runs agent tasks, and routes results
 * to lifecycle handlers.
 * Not responsible for task completion/failure state (see task-lifecycle.ts)
 * or session-level concerns.
 */

import { PrismaClient } from '@prisma/client';
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

import { SubAgentController } from './sub-agent-controller';
import { LogAggregator } from './log-aggregator';
import { AgentCoordinator } from './agent-coordinator';
import { ConflictDetector } from './conflict-detector';
import { GitOperations } from '../agents/orchestrator/git-operations';
import { ParallelScheduler } from './parallel-scheduler';
import { dbMutex, withRetry } from './db-utils';
import type { ParallelExecutionSession, TaskNode } from './types';
import type { AgentTask, AgentExecutionResult } from '../agents/base-agent';
import type { ParallelExecutionEvent } from './executor-types';
import {
  handleTaskCompletion,
  handleTaskFailure,
  type TaskLifecycleContext,
} from './task-lifecycle';
import { createLogger } from '../../config/logger';

const logger = createLogger('parallel-executor:task-runner');

/**
 * Context passed to the TaskRunner so it can interact with session state.
 */
export interface TaskRunnerContext extends TaskLifecycleContext {
  agentController: SubAgentController;
  logAggregator: LogAggregator;
}

/**
 * Execute a single task within a parallel session.
 *
 * Creates an isolated git worktree, manages AgentExecution DB records,
 * runs the agent, and delegates to completion/failure handlers.
 *
 * @param ctx - Runner context providing session state and service references
 * @param sessionId - ID of the current parallel session / 現在のセッションID
 * @param taskId - ID of the task to execute / 実行するタスクID
 * @param node - Task node containing title and description / タスクノード
 * @param workingDirectory - Repository working directory / リポジトリのワーキングディレクトリ
 */
export async function executeTask(
  ctx: TaskRunnerContext,
  sessionId: string,
  taskId: number,
  node: TaskNode,
  workingDirectory: string,
): Promise<void> {
  const session = ctx.sessions.get(sessionId);
  if (!session) return;

  logger.info(`[ParallelExecutor] Starting task ${taskId}: ${node.title}`);

  try {
    const dbTask = await ctx.prisma.task.findUnique({
      where: { id: taskId },
      include: { theme: true },
    });

    const repositoryUrl = dbTask?.theme?.repositoryUrl || null;

    // NOTE: Create isolated worktree for this task to prevent git conflicts
    let taskWorkDir = workingDirectory;
    try {
      const branchName = `feature/task-${taskId}-parallel`;
      taskWorkDir = await ctx.gitOps.createWorktree(workingDirectory, branchName, taskId, repositoryUrl);
      ctx.taskWorktrees.set(taskId, taskWorkDir);
      session.taskBranches.set(taskId, branchName);
      ctx.conflictDetector.startTracking(taskId, `agent-${taskId}`, taskWorkDir);
      logger.info(`[ParallelExecutor] Created worktree for task ${taskId}: ${taskWorkDir}`);
    } catch (wtError) {
      logger.error({ err: wtError }, `[ParallelExecutor] Worktree creation failed for task ${taskId}, using shared directory`);
      // HACK(agent): Fallback to shared directory if worktree creation fails
      taskWorkDir = workingDirectory;
    }

    await dbMutex.acquire();
    let agentSession;
    let execution;
    try {
      agentSession = await withRetry(async () => {
        return await ctx.prisma.agentSession.findFirst({
          where: { config: { taskId: session.parentTaskId } },
          orderBy: { createdAt: 'desc' },
        });
      });

      if (!agentSession) {
        throw new Error(`No agent session found for parent task ${session.parentTaskId}`);
      }

      execution = await withRetry(async () => {
        return await ctx.prisma.agentExecution.create({
          data: {
            sessionId: agentSession!.id,
            command: node.description || node.title,
            status: 'running',
            startedAt: new Date(),
          },
        });
      });
    } finally {
      dbMutex.release();
    }

    const agentId = ctx.agentController.createAgent(taskId, execution.id, taskWorkDir);

    session.activeAgents.set(agentId, {
      agentId, taskId, executionId: execution.id,
      status: 'running',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      output: '', artifacts: [], tokensUsed: 0, executionTimeMs: 0, watingForInput: false,
    });

    ctx.emitEvent({ type: 'task_started', sessionId, taskId, timestamp: new Date() });

    try {
      await dbMutex.acquire();
      await withRetry(async () => {
        await ctx.prisma.task.update({ where: { id: taskId }, data: { status: 'in-progress' } });
      });
      logger.info(`[ParallelExecutor] Updated task ${taskId} status to 'in-progress'`);
    } catch (error) {
      logger.error({ err: error }, '[ParallelExecutor] Failed to update task status');
    } finally {
      dbMutex.release();
    }

    // Look up previous session ID for agent continuation
    let previousSessionId: string | null = null;
    try {
      const previousExecution = await ctx.prisma.agentExecution.findFirst({
        where: { session: { config: { taskId } }, claudeSessionId: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      if (previousExecution?.claudeSessionId) {
        previousSessionId = previousExecution.claudeSessionId;
        logger.info(`[ParallelExecutor] Found previous session for task ${taskId}: ${previousSessionId}`);
      }
    } catch {
      logger.info(`[ParallelExecutor] No previous session found for task ${taskId}`);
    }

    const agentTask: AgentTask = {
      id: taskId,
      title: node.title,
      description: node.description,
      workingDirectory: taskWorkDir,
      resumeSessionId: previousSessionId || undefined,
    };

    const result = await ctx.agentController.executeTask(agentId, agentTask);

    // Persist execution result to DB
    try {
      await dbMutex.acquire();
      // NOTE: 'waiting_for_input' is a valid terminal status for user-gated tasks
      const executionStatus = result.waitingForInput ? 'waiting_for_input' : result.success ? 'completed' : 'failed';
      await withRetry(async () => {
        await ctx.prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: executionStatus,
            output: result.output,
            completedAt: result.waitingForInput ? null : new Date(),
            tokensUsed: result.tokensUsed || 0,
            executionTimeMs: result.executionTimeMs,
            errorMessage: result.errorMessage,
            claudeSessionId: result.claudeSessionId || null,
          },
        });
      });
      logger.info(`[ParallelExecutor] Saved execution for task ${taskId}: ${executionStatus}`);
    } finally {
      dbMutex.release();
    }

    if (result.waitingForInput) {
      logger.info(`[ParallelExecutor] Task ${taskId} waiting for input: ${result.question?.substring(0, 200)}`);

      try {
        await dbMutex.acquire();
        await withRetry(async () => {
          await ctx.prisma.task.update({ where: { id: taskId }, data: { status: 'waiting' } });
        });
      } catch (error) {
        logger.error({ err: error }, '[ParallelExecutor] Failed to update task status');
      } finally {
        dbMutex.release();
      }

      ctx.emitEvent({
        type: 'task_failed', // Emitted as 'task_failed' so the UI can display the question
        sessionId,
        taskId,
        timestamp: new Date(),
        data: { waitingForInput: true, question: result.question, questionDetails: result.questionDetails, claudeSessionId: result.claudeSessionId },
      });

      return;
    }

    if (result.success) {
      await handleTaskCompletion(ctx, sessionId, taskId, result);
    } else {
      await handleTaskFailure(ctx, sessionId, taskId, result.errorMessage);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ errorMessage }, `[ParallelExecutor] Task ${taskId} failed`);
    await handleTaskFailure(ctx, sessionId, taskId, errorMessage);
  }
}

// Re-export lifecycle handlers for use by parallel-executor.ts
export { handleTaskCompletion, handleTaskFailure };
