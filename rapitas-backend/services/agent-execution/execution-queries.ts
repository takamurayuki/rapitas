/**
 * Execution Queries
 *
 * Read-only queries for agent execution state: status lookups,
 * listing active/interrupted/resumable executions, and reset.
 * Mutation operations live in execution-core.ts.
 */
import { PrismaClient } from '@prisma/client';
import { orchestrator } from '../orchestrator-instance';
import type { AgentExecutionWithExtras } from '../../types/agent-execution-types';
import { createLogger } from '../../config/logger';

const log = createLogger('agent-execution-service');

/**
 * Returns the execution status with related data.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param executionId - Execution to look up / 参照する実行ID
 * @returns Full execution record or null / 実行レコード（存在しない場合はnull）
 */
export async function getExecutionStatus(
  prisma: PrismaClient,
  executionId: number,
): Promise<AgentExecutionWithExtras | null> {
  return await prisma.agentExecution.findUnique({
    where: { id: executionId },
    include: {
      agentConfig: true,
      session: true,
      executionLogs: {
        orderBy: { timestamp: 'asc' },
      },
    },
  });
}

/**
 * Retrieves the most recent execution for a task.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param taskId - Task whose latest execution is requested / タスクID
 * @returns Latest execution record or null / 最新の実行レコード（存在しない場合はnull）
 */
export async function getLatestExecution(
  prisma: PrismaClient,
  taskId: number,
): Promise<AgentExecutionWithExtras | null> {
  return await prisma.agentExecution.findFirst({
    where: {
      session: {
        config: {
          taskId: taskId,
        },
      },
    },
    orderBy: { startedAt: 'desc' },
    include: {
      agentConfig: true,
      session: true,
      executionLogs: {
        orderBy: { timestamp: 'asc' },
        take: 10,
      },
    },
  });
}

/**
 * Lists all currently active executions.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @returns Array of running/pending executions / 実行中・待機中の実行一覧
 */
export async function getExecutingTasks(
  prisma: PrismaClient,
): Promise<AgentExecutionWithExtras[]> {
  return await prisma.agentExecution.findMany({
    where: {
      status: { in: ['running', 'pending', 'waiting_for_input'] },
    },
    include: {
      agentConfig: true,
      session: true,
    },
    orderBy: { startedAt: 'desc' },
  });
}

/**
 * Resets the execution state for a task, stopping and cleaning up logs.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param taskId - Task whose execution should be reset / リセット対象タスクID
 * @throws {Error} When no execution is found for the task
 */
export async function resetExecutionState(prisma: PrismaClient, taskId: number): Promise<void> {
  const latestExecution = await prisma.agentExecution.findFirst({
    where: {
      session: {
        config: {
          taskId: taskId,
        },
      },
    },
    orderBy: { startedAt: 'desc' },
  });

  if (!latestExecution) {
    throw new Error('リセット対象の実行が見つかりません');
  }

  if (['running', 'pending', 'waiting_for_input'].includes(latestExecution.status)) {
    await orchestrator.stopExecution(latestExecution.id).catch((err) => {
      log.warn({ err, executionId: latestExecution.id }, 'Failed to stop execution before reset');
    });
  }

  await prisma.agentExecution.update({
    where: { id: latestExecution.id },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
    },
  });

  await prisma.agentExecutionLog.deleteMany({
    where: { executionId: latestExecution.id },
  });
}

/**
 * Lists interrupted executions that can be resumed (within 24 hours).
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @returns Resumable executions ordered by most recently completed / 再開可能な実行一覧
 */
export async function getResumableExecutions(
  prisma: PrismaClient,
): Promise<AgentExecutionWithExtras[]> {
  return await prisma.agentExecution.findMany({
    where: {
      status: 'interrupted',
      // NOTE: 24-hour window; executions older than this are considered stale.
      completedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    include: {
      agentConfig: true,
      session: true,
    },
    orderBy: { completedAt: 'desc' },
  });
}

/**
 * Lists failed/interrupted/cancelled executions within the past week.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @returns Interrupted executions ordered by most recently completed / 中断された実行一覧
 */
export async function getInterruptedExecutions(
  prisma: PrismaClient,
): Promise<AgentExecutionWithExtras[]> {
  return await prisma.agentExecution.findMany({
    where: {
      status: { in: ['interrupted', 'error', 'cancelled'] },
      // NOTE: 7-day window; older entries are excluded from the interrupted view.
      completedAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    include: {
      agentConfig: true,
      session: true,
    },
    orderBy: { completedAt: 'desc' },
  });
}
