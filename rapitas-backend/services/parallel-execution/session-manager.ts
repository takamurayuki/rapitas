/**
 * ParallelExecution — SessionManager
 *
 * Manages the executeNextBatch and completeSession logic for parallel execution sessions.
 * Handles safety reports and session state transitions on completion.
 * Not responsible for individual task execution or event infrastructure.
 */

import { ParallelScheduler } from './parallel-scheduler';
import { MergeValidator } from './merge-validator';
import { ConflictDetector } from './conflict-detector';
import { AgentCoordinator } from './agent-coordinator';
import { SubAgentController } from './sub-agent-controller';
import type { ParallelExecutionSession, TaskNode, ParallelExecutionConfig } from './types-dir/types';
import type { ParallelExecutionEvent } from './types-dir/executor-types';
import { executeTask } from './task-runner';
import type { TaskRunnerContext } from './task-runner';
import { createLogger } from '../../config/logger';

const logger = createLogger('parallel-executor:session-manager');

/**
 * Context passed to session manager functions.
 */
export interface SessionManagerContext {
  sessions: Map<string, ParallelExecutionSession>;
  schedulers: Map<string, ParallelScheduler>;
  agentController: SubAgentController;
  coordinator: AgentCoordinator;
  mergeValidator: MergeValidator;
  conflictDetector: ConflictDetector;
  config: ParallelExecutionConfig;
  emitEvent: (event: ParallelExecutionEvent) => void;
  buildRunnerContext: () => TaskRunnerContext;
}

/**
 * Execute the next available batch of tasks from the scheduler.
 *
 * @param ctx - Session manager context / セッション管理コンテキスト
 * @param sessionId - Session ID / セッションID
 * @param nodes - Task node map / タスクノードマップ
 * @param workingDirectory - Working directory / ワーキングディレクトリ
 */
export async function executeNextBatch(
  ctx: SessionManagerContext,
  sessionId: string,
  nodes: Map<number, TaskNode>,
  workingDirectory: string,
): Promise<void> {
  const scheduler = ctx.schedulers.get(sessionId);
  const session = ctx.sessions.get(sessionId);

  if (!scheduler || !session || session.status !== 'running') {
    return;
  }

  const executableTasks = scheduler.getNextExecutableTasks();

  if (executableTasks.length === 0) {
    if (ctx.agentController.getActiveAgentCount() === 0) {
      await completeSession(ctx, sessionId);
    }
    return;
  }

  logger.info(`[ParallelExecutor] Executing batch of ${executableTasks.length} tasks`);

  const promises: Promise<void>[] = [];

  for (const taskId of executableTasks) {
    const node = nodes.get(taskId);
    if (!node) continue;

    if (!scheduler.startTask(taskId)) {
      logger.warn(`[ParallelExecutor] Failed to start task ${taskId}`);
      continue;
    }

    promises.push(executeTask(ctx.buildRunnerContext(), sessionId, taskId, node, workingDirectory));
  }

  await Promise.all(promises);
}

/**
 * Finalize a session: run safety checks if enabled, emit completion event.
 *
 * @param ctx - Session manager context / セッション管理コンテキスト
 * @param sessionId - Session ID to complete / 完了するセッションID
 */
export async function completeSession(
  ctx: SessionManagerContext,
  sessionId: string,
): Promise<void> {
  const session = ctx.sessions.get(sessionId);
  if (!session) return;

  const success = session.failedTasks.length === 0;
  session.status = success ? 'completed' : 'failed';
  session.completedAt = new Date();

  logger.info(`[ParallelExecutor] Session ${sessionId} ${session.status}`);
  logger.info(`[ParallelExecutor] - Completed: ${session.completedTasks.length}`);
  logger.info(`[ParallelExecutor] - Failed: ${session.failedTasks.length}`);
  logger.info(`[ParallelExecutor] - Total time: ${session.totalExecutionTimeMs}ms`);

  // NOTE: Run safety checks when multiple tasks completed and safety is enabled
  if (ctx.config.safetyCheckEnabled !== false && session.completedTasks.length > 1) {
    try {
      const taskBranches = session.completedTasks
        .map((id) => ({ taskId: id, branchName: session.taskBranches.get(id)! }))
        .filter((b) => b.branchName);

      if (taskBranches.length > 1) {
        const report = await ctx.mergeValidator.generateSafetyReport(
          sessionId,
          session.workingDirectory,
          taskBranches,
          'develop',
          ctx.conflictDetector.getActiveConflicts(),
        );

        ctx.coordinator.shareData(`safety-report:${sessionId}`, report, 'system');

        ctx.emitEvent({
          type: 'safety_report_ready',
          sessionId,
          timestamp: new Date(),
          data: report,
        });

        logger.info(
          `[ParallelExecutor] Safety report ready for session ${sessionId}: ${report.recommendation}`,
        );
      }
    } catch (error) {
      logger.error({ err: error }, '[ParallelExecutor] Failed to generate safety report');
    }
  }

  ctx.emitEvent({
    type: success ? 'session_completed' : 'session_failed',
    sessionId,
    timestamp: new Date(),
    data: {
      completedTasks: session.completedTasks.length,
      failedTasks: session.failedTasks.length,
      totalTokensUsed: session.totalTokensUsed,
      totalExecutionTimeMs: session.totalExecutionTimeMs,
    },
  });
}
