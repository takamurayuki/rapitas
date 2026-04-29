/**
 * ParallelExecution — TaskLifecycle
 *
 * Handles task completion and failure state transitions: updates DB task status,
 * emits lifecycle events, cleans up worktrees, and schedules the next batch.
 * Not responsible for initial task execution or DB record creation.
 */

import { ParallelScheduler } from './parallel-scheduler';
import { AgentCoordinator } from './agent-coordinator';
import { ConflictDetector } from './conflict-detector';
import { GitOperations } from '../agents/orchestrator/git-operations';
import { dbMutex, withRetry } from './db-utils';
import type { ParallelExecutionSession, TaskNode } from './types-dir/types';
import type { AgentExecutionResult } from '../agents/base-agent';
import type { ParallelExecutionEvent } from './types-dir/executor-types';
import { createLogger } from '../../config/logger';
import { PrismaClient } from '@prisma/client';

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

const logger = createLogger('parallel-executor:task-lifecycle');

/** Minimal context needed for lifecycle operations. */
export interface TaskLifecycleContext {
  sessions: Map<string, ParallelExecutionSession>;
  schedulers: Map<string, ParallelScheduler>;
  taskWorktrees: Map<number, string>;
  coordinator: AgentCoordinator;
  conflictDetector: ConflictDetector;
  gitOps: GitOperations;
  logSequenceNumbers: Map<number, number>;
  prisma: PrismaClientInstance;
  emitEvent: (event: ParallelExecutionEvent) => void;
  executeNextBatch: (
    sessionId: string,
    nodes: Map<number, TaskNode>,
    workingDirectory: string,
  ) => Promise<void>;
}

/**
 * Handle successful task completion: update DB, emit events, schedule next batch.
 *
 * @param ctx - Lifecycle context / ライフサイクルコンテキスト
 * @param sessionId - Session ID / セッションID
 * @param taskId - Completed task ID / 完了したタスクID
 * @param result - Agent execution result / エージェント実行結果
 */
export async function handleTaskCompletion(
  ctx: TaskLifecycleContext,
  sessionId: string,
  taskId: number,
  result: AgentExecutionResult,
): Promise<void> {
  const session = ctx.sessions.get(sessionId);
  const scheduler = ctx.schedulers.get(sessionId);

  if (!session || !scheduler) return;

  logger.info(`[ParallelExecutor] Task ${taskId} completed`);

  scheduler.completeTask(taskId);
  ctx.coordinator.resolveDependency(taskId);

  session.completedTasks.push(taskId);
  session.lastActivityAt = new Date();
  session.totalTokensUsed += result.tokensUsed || 0;
  session.totalExecutionTimeMs += result.executionTimeMs || 0;

  ctx.conflictDetector.stopTracking(taskId);

  // NOTE: Clean up worktree after successful execution (branch is preserved on remote)
  await cleanupTaskWorktree(ctx, taskId, session.workingDirectory);

  try {
    await dbMutex.acquire();
    await withRetry(async () => {
      // NOTE: Parallel execution mode does NOT create PRs — it's a batch
      // runner for independent tasks. status='done' here represents
      // "agent execution succeeded"; PR/merge is performed afterwards via
      // /agents/parallel-execution/pr-routes (which sets completedAt again,
      // idempotent). The workflow flow has stricter semantics (verify→PR
      // gates done) — see routes/workflow/handlers/workflow-handlers-files.
      await ctx.prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'done',
          completedAt: new Date(),
          actualHours: result.executionTimeMs ? result.executionTimeMs / 3600000 : undefined,
        },
      });
    });
    logger.info(`[ParallelExecutor] Updated task ${taskId} status to 'done'`);
  } catch (error) {
    logger.error({ err: error }, '[ParallelExecutor] Failed to update task status');
  } finally {
    dbMutex.release();
  }

  ctx.emitEvent({
    type: 'task_completed',
    sessionId,
    taskId,
    timestamp: new Date(),
    data: { executionTimeMs: result.executionTimeMs, tokensUsed: result.tokensUsed },
  });

  const status = scheduler.getStatus();
  ctx.emitEvent({
    type: 'progress_updated',
    sessionId,
    timestamp: new Date(),
    data: {
      progress: status.progress,
      completed: status.completed.length,
      running: status.running.length,
      pending: status.pending.length,
      failed: status.failed.length,
    },
  });

  await ctx.executeNextBatch(sessionId, session.nodes, session.workingDirectory);
}

/**
 * Handle task failure: update DB, emit events, schedule next batch.
 *
 * @param ctx - Lifecycle context / ライフサイクルコンテキスト
 * @param sessionId - Session ID / セッションID
 * @param taskId - Failed task ID / 失敗したタスクID
 * @param errorMessage - Error description / エラーの説明
 */
export async function handleTaskFailure(
  ctx: TaskLifecycleContext,
  sessionId: string,
  taskId: number,
  errorMessage?: string,
): Promise<void> {
  const session = ctx.sessions.get(sessionId);
  const scheduler = ctx.schedulers.get(sessionId);

  if (!session || !scheduler) return;

  logger.error(`[ParallelExecutor] Task ${taskId} failed: ${errorMessage}`);

  scheduler.failTask(taskId);
  session.failedTasks.push(taskId);
  session.lastActivityAt = new Date();

  try {
    await dbMutex.acquire();
    await withRetry(async () => {
      await ctx.prisma.task.update({
        where: { id: taskId },
        data: { status: 'todo' },
      });
    });
    logger.info(`[ParallelExecutor] Reverted task ${taskId} status to 'todo' due to failure`);
  } catch (error) {
    logger.error({ err: error }, '[ParallelExecutor] Failed to update task status');
  } finally {
    dbMutex.release();
  }

  ctx.emitEvent({
    type: 'task_failed',
    sessionId,
    taskId,
    timestamp: new Date(),
    data: { errorMessage },
  });

  const status = scheduler.getStatus();
  ctx.emitEvent({
    type: 'progress_updated',
    sessionId,
    timestamp: new Date(),
    data: {
      progress: status.progress,
      completed: status.completed.length,
      running: status.running.length,
      pending: status.pending.length,
      failed: status.failed.length,
    },
  });

  await ctx.executeNextBatch(sessionId, session.nodes, session.workingDirectory);
}

/**
 * Clean up the git worktree for a completed or failed task.
 *
 * @param ctx - Lifecycle context / ライフサイクルコンテキスト
 * @param taskId - Task whose worktree to remove / 削除するタスクID
 * @param baseDir - Main repository root directory / リポジトリルートディレクトリ
 */
export async function cleanupTaskWorktree(
  ctx: TaskLifecycleContext,
  taskId: number,
  baseDir: string,
): Promise<void> {
  const worktreePath = ctx.taskWorktrees.get(taskId);
  if (!worktreePath) return;

  try {
    await ctx.gitOps.removeWorktree(baseDir, worktreePath);
    ctx.taskWorktrees.delete(taskId);
    logger.info(`[ParallelExecutor] Cleaned up worktree for task ${taskId}: ${worktreePath}`);
  } catch (error) {
    logger.warn({ err: error }, `[ParallelExecutor] Failed to cleanup worktree for task ${taskId}`);
  }
}
