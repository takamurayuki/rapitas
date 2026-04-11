/**
 * Agent Metrics Queries
 *
 * Database query functions that aggregate agent execution data into metrics
 * structures: per-agent metrics, execution trends, and the overall overview.
 * Performance comparison queries live in performance-query.ts.
 * All functions are pure data-access utilities; routing is handled in router.ts.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import type { AgentMetrics, ExecutionTrendData, MetricsOverview, DateRange } from './types';

const prisma = new PrismaClient();

type ExecutionWhereInput = Prisma.AgentExecutionWhereInput;

/**
 * Builds a Prisma where clause from an optional date range.
 *
 * @param dateRange - Optional date filter / 日付フィルター（任意）
 * @returns Prisma where clause / Prismaのwhere条件
 */
export function buildDateWhereClause(dateRange?: DateRange): ExecutionWhereInput {
  const whereClause: ExecutionWhereInput = {};

  if (dateRange?.startDate || dateRange?.endDate) {
    whereClause.createdAt = {};
    if (dateRange.startDate) {
      whereClause.createdAt.gte = new Date(dateRange.startDate);
    }
    if (dateRange.endDate) {
      whereClause.createdAt.lte = new Date(dateRange.endDate);
    }
  }

  return whereClause;
}

/**
 * Retrieves detailed metrics for each agent within an optional date range.
 *
 * @param dateRange - Optional date filter / 日付フィルター（任意）
 * @returns Array of per-agent metrics / エージェントごとのメトリクス配列
 */
export async function getAgentMetrics(dateRange?: DateRange): Promise<AgentMetrics[]> {
  const whereClause = buildDateWhereClause(dateRange);

  const agents = await prisma.aIAgentConfig.findMany({
    include: {
      executions: {
        where: whereClause,
        select: {
          id: true,
          status: true,
          tokensUsed: true,
          executionTimeMs: true,
          completedAt: true,
          startedAt: true,
          errorMessage: true,
        },
      },
    },
  });

  return agents.map((agent) => {
    const executions = agent.executions;
    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter((e) => e.status === 'completed').length;
    const failedExecutions = executions.filter(
      (e) => e.status === 'failed' || e.errorMessage,
    ).length;
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

    const totalTokens = executions.reduce((sum, e) => sum + (e.tokensUsed || 0), 0);
    const averageTokensPerExecution = totalExecutions > 0 ? totalTokens / totalExecutions : null;

    const executionTimes = executions
      .filter((e) => e.executionTimeMs && e.executionTimeMs > 0)
      .map((e) => e.executionTimeMs!);
    const averageExecutionTime =
      executionTimes.length > 0
        ? executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length
        : null;

    const lastExecution = executions
      .filter((e) => e.completedAt)
      .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())[0];

    return {
      agentId: agent.id,
      agentName: agent.name,
      agentType: agent.agentType,
      modelId: agent.modelId,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      successRate: Math.round(successRate * 100) / 100,
      averageExecutionTimeMs: averageExecutionTime ? Math.round(averageExecutionTime) : null,
      totalTokensUsed: totalTokens,
      averageTokensPerExecution: averageTokensPerExecution
        ? Math.round(averageTokensPerExecution)
        : null,
      lastExecutionAt: lastExecution?.completedAt || null,
      isActive: agent.isActive,
    };
  });
}

/**
 * Aggregates execution trend data grouped by date.
 *
 * @param period - Grouping period / グルーピング期間
 * @param days - Number of days to look back / 遡る日数
 * @returns Sorted array of daily trend data / 日別トレンドデータの配列
 */
export async function getExecutionTrends(
  period: 'day' | 'week' | 'month' = 'day',
  days: number = 30,
): Promise<ExecutionTrendData[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const executions = await prisma.agentExecution.findMany({
    where: {
      createdAt: {
        gte: startDate,
      },
    },
    select: {
      createdAt: true,
      status: true,
      tokensUsed: true,
      executionTimeMs: true,
    },
  });

  const groupedData: Record<
    string,
    {
      successful: number;
      failed: number;
      totalTokens: number;
      executionTimes: number[];
    }
  > = {};

  executions.forEach((execution) => {
    const date = execution.createdAt.toISOString().split('T')[0];
    if (!groupedData[date]) {
      groupedData[date] = {
        successful: 0,
        failed: 0,
        totalTokens: 0,
        executionTimes: [],
      };
    }

    if (execution.status === 'completed') {
      groupedData[date].successful++;
    } else if (execution.status === 'failed') {
      groupedData[date].failed++;
    }

    groupedData[date].totalTokens += execution.tokensUsed || 0;

    if (execution.executionTimeMs) {
      groupedData[date].executionTimes.push(execution.executionTimeMs);
    }
  });

  return Object.entries(groupedData)
    .map(([date, data]) => ({
      date,
      successful: data.successful,
      failed: data.failed,
      totalTokens: data.totalTokens,
      averageTime:
        data.executionTimes.length > 0
          ? Math.round(
              data.executionTimes.reduce((sum, time) => sum + time, 0) / data.executionTimes.length,
            )
          : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Returns a high-level overview of all agent execution metrics.
 *
 * @param dateRange - Optional date filter / 日付フィルター（任意）
 * @returns Aggregated overview metrics / 集計されたメトリクス概要
 */
export async function getMetricsOverview(dateRange?: DateRange): Promise<MetricsOverview> {
  const whereClause = buildDateWhereClause(dateRange);

  const [executions, totalAgents, activeAgents] = await Promise.all([
    prisma.agentExecution.findMany({
      where: whereClause,
      select: {
        status: true,
        tokensUsed: true,
        executionTimeMs: true,
      },
    }),
    prisma.aIAgentConfig.count(),
    prisma.aIAgentConfig.count({
      where: { isActive: true },
    }),
  ]);

  const totalExecutions = executions.length;
  const totalSuccessful = executions.filter((e) => e.status === 'completed').length;
  const totalFailed = executions.filter((e) => e.status === 'failed').length;
  const overallSuccessRate = totalExecutions > 0 ? (totalSuccessful / totalExecutions) * 100 : 0;

  const totalTokensUsed = executions.reduce((sum, e) => sum + (e.tokensUsed || 0), 0);

  const executionTimes = executions
    .filter((e) => e.executionTimeMs && e.executionTimeMs > 0)
    .map((e) => e.executionTimeMs!);
  const averageExecutionTime =
    executionTimes.length > 0
      ? executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length
      : null;

  return {
    totalExecutions,
    totalSuccessful,
    totalFailed,
    overallSuccessRate: Math.round(overallSuccessRate * 100) / 100,
    totalTokensUsed,
    totalAgents,
    activeAgents,
    averageExecutionTime: averageExecutionTime ? Math.round(averageExecutionTime) : null,
  };
}

export { prisma };
