/**
 * Stale Execution Recovery
 *
 * Handles detection and cleanup of executions that were interrupted by a server restart.
 * Not responsible for actually resuming execution — see execution-resume.ts.
 */

import { createLogger } from '../../../config';
import type { OrchestratorContext } from './types';

const logger = createLogger('stale-execution-recovery');

/**
 * Marks stale running/pending executions as interrupted and updates related sessions and tasks.
 * Called once on server startup.
 *
 * @param ctx - Orchestrator context with prisma client and server metadata / オーケストレーターコンテキスト
 * @returns Summary of what was updated / 更新サマリー
 */
export async function recoverStaleExecutions(ctx: OrchestratorContext): Promise<{
  recoveredExecutions: number;
  updatedTasks: number;
  updatedSessions: number;
  interruptedExecutionIds: number[];
}> {
  logger.info('[RecoveryManager] Starting startup recovery of stale executions...');

  let recoveredExecutions = 0;
  let updatedTasks = 0;
  let updatedSessions = 0;
  const interruptedExecutionIds: number[] = [];

  try {
    const activeExecutionIds = Array.from(ctx.activeExecutions.values()).map((e) => e.executionId);

    const staleExecutions = await ctx.prisma.agentExecution.findMany({
      where: {
        status: { in: ['running', 'pending', 'waiting_for_input'] },
        id: { notIn: activeExecutionIds },
        createdAt: { lt: ctx.serverStartedAt },
      },
      include: {
        session: {
          include: {
            config: {
              include: {
                task: {
                  select: { id: true, title: true, status: true },
                },
              },
            },
          },
        },
      },
    });

    if (staleExecutions.length === 0) {
      logger.info('[RecoveryManager] No stale executions found. Recovery complete.');
      return {
        recoveredExecutions: 0,
        updatedTasks: 0,
        updatedSessions: 0,
        interruptedExecutionIds: [],
      };
    }

    logger.info(`[RecoveryManager] Found ${staleExecutions.length} stale executions to recover`);

    const affectedSessionIds = new Set<number>();
    const affectedTaskIds = new Set<number>();

    for (const exec of staleExecutions) {
      try {
        await ctx.prisma.agentExecution.update({
          where: { id: exec.id },
          data: {
            status: 'interrupted',
            completedAt: new Date(),
            errorMessage: `サーバー再起動により中断されました。\n\n【最後の出力】\n${(exec.output || '').slice(-1000)}`,
          },
        });
        recoveredExecutions++;
        interruptedExecutionIds.push(exec.id);

        affectedSessionIds.add(exec.sessionId);

        const taskId = exec.session?.config?.task?.id;
        if (taskId) {
          affectedTaskIds.add(taskId);
        }

        logger.info(`[RecoveryManager] Execution ${exec.id} marked as interrupted`);
      } catch (error) {
        logger.error(
          { err: error, executionId: exec.id },
          `[RecoveryManager] Failed to recover execution`,
        );
      }
    }

    await updateAffectedSessions(ctx, affectedSessionIds);
    updatedSessions = affectedSessionIds.size;

    const tasksUpdated = await updateAffectedTasks(ctx, affectedTaskIds);
    updatedTasks = tasksUpdated;

    if (recoveredExecutions > 0) {
      await createRecoveryNotification(ctx, recoveredExecutions, updatedTasks, updatedSessions);
    }

    logger.info(
      `[RecoveryManager] Recovery complete: ${recoveredExecutions} executions, ${updatedTasks} tasks, ${updatedSessions} sessions updated`,
    );
  } catch (error) {
    logger.error({ err: error }, '[RecoveryManager] Startup recovery failed');
  }

  return {
    recoveredExecutions,
    updatedTasks,
    updatedSessions,
    interruptedExecutionIds,
  };
}

/**
 * Marks affected sessions as interrupted when they have no remaining active executions.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param sessionIds - Set of session IDs to check / チェックするセッションIDのセット
 */
async function updateAffectedSessions(
  ctx: OrchestratorContext,
  sessionIds: Set<number>,
): Promise<void> {
  for (const sessionId of sessionIds) {
    try {
      const activeCount = await ctx.prisma.agentExecution.count({
        where: {
          sessionId,
          status: { in: ['running', 'pending', 'waiting_for_input'] },
        },
      });

      if (activeCount === 0) {
        await ctx.prisma.agentSession.update({
          where: { id: sessionId },
          data: {
            status: 'interrupted',
            lastActivityAt: new Date(),
          },
        });
        logger.info(`[RecoveryManager] Session ${sessionId} marked as interrupted`);
      }
    } catch (error) {
      logger.error({ err: error, sessionId }, `[RecoveryManager] Failed to update session`);
    }
  }
}

/**
 * Reverts in-progress tasks to 'todo' status.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param taskIds - Set of task IDs to revert / 元に戻すタスクIDのセット
 * @returns Number of tasks that were updated / 更新されたタスクの数
 */
async function updateAffectedTasks(
  ctx: OrchestratorContext,
  taskIds: Set<number>,
): Promise<number> {
  let updated = 0;
  for (const taskId of taskIds) {
    try {
      const task = await ctx.prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, status: true },
      });

      if (task && task.status === 'in-progress') {
        await ctx.prisma.task.update({
          where: { id: taskId },
          data: { status: 'todo' },
        });
        updated++;
        logger.info(`[RecoveryManager] Task ${taskId} reverted to 'todo'`);
      }
    } catch (error) {
      logger.error({ err: error, taskId }, `[RecoveryManager] Failed to update task`);
    }
  }
  return updated;
}

/**
 * Creates a notification record informing the user about recovered executions.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param recoveredExecutions - Count of recovered executions / 復旧した実行数
 * @param updatedTasks - Count of updated tasks / 更新されたタスク数
 * @param updatedSessions - Count of updated sessions / 更新されたセッション数
 */
async function createRecoveryNotification(
  ctx: OrchestratorContext,
  recoveredExecutions: number,
  updatedTasks: number,
  updatedSessions: number,
): Promise<void> {
  try {
    await ctx.prisma.notification.create({
      data: {
        type: 'agent_execution_interrupted',
        title: 'サーバー再起動による中断',
        message: `サーバー再起動により${recoveredExecutions}件のエージェント実行が中断されました。バナーから再開できます。`,
        link: '/',
        metadata: JSON.stringify({
          recoveredExecutions,
          updatedTasks,
          updatedSessions,
        }),
      },
    });
  } catch (error) {
    logger.error({ err: error }, '[RecoveryManager] Failed to create recovery notification');
  }
}

/**
 * Returns all executions currently in the 'interrupted' state, newest first.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @returns Array of interrupted execution records / 中断された実行のレコード配列
 */
export async function getInterruptedExecutions(prisma: OrchestratorContext['prisma']): Promise<
  Array<{
    id: number;
    sessionId: number;
    status: string;
    claudeSessionId: string | null;
    output: string;
    createdAt: Date;
  }>
> {
  return (await prisma.agentExecution.findMany({
    where: { status: 'interrupted' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })) as Array<{
    id: number;
    sessionId: number;
    status: string;
    claudeSessionId: string | null;
    output: string;
    createdAt: Date;
  }>;
}
