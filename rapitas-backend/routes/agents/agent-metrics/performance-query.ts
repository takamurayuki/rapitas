/**
 * Agent Performance Comparison Query
 *
 * Provides getAgentPerformanceComparison, which groups execution records by
 * agent type + model and computes per-group success rates, average times, and
 * token totals. Separated from queries.ts to keep file sizes manageable.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import type { AgentPerformanceComparison, DateRange } from './types';

const prisma = new PrismaClient();

type ExecutionWhereInput = Prisma.AgentExecutionWhereInput;

/**
 * Builds a Prisma where clause from an optional date range.
 *
 * @param dateRange - Optional date filter / 日付フィルター（任意）
 * @returns Prisma where clause / Prismaのwhere条件
 */
function buildDateWhereClause(dateRange?: DateRange): ExecutionWhereInput {
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
 * Compares performance across agent type + model combinations.
 *
 * @param dateRange - Optional date filter / 日付フィルター（任意）
 * @returns Performance comparison sorted by execution count / 実行数順のパフォーマンス比較
 */
export async function getAgentPerformanceComparison(
  dateRange?: DateRange,
): Promise<AgentPerformanceComparison[]> {
  const whereClause = buildDateWhereClause(dateRange);

  const executions = await prisma.agentExecution.findMany({
    where: whereClause,
    include: {
      agentConfig: {
        select: {
          agentType: true,
          modelId: true,
        },
      },
    },
  });

  const groupedData: Record<
    string,
    {
      agentType: string;
      modelId: string;
      executions: Array<{
        id: number;
        status: string;
        executionTimeMs: number | null;
        tokensUsed: number;
        agentConfig: {
          agentType: string;
          modelId: string | null;
        } | null;
      }>;
    }
  > = {};

  executions.forEach((execution) => {
    if (!execution.agentConfig) return;

    const key = `${execution.agentConfig.agentType}:${execution.agentConfig.modelId || 'unknown'}`;
    if (!groupedData[key]) {
      groupedData[key] = {
        agentType: execution.agentConfig.agentType,
        modelId: execution.agentConfig.modelId || 'unknown',
        executions: [],
      };
    }
    groupedData[key].executions.push(execution);
  });

  return Object.values(groupedData)
    .map((group) => {
      const totalExecutions = group.executions.length;
      const successful = group.executions.filter((e) => e.status === 'completed').length;
      const successRate = totalExecutions > 0 ? (successful / totalExecutions) * 100 : 0;

      const executionTimes = group.executions
        .filter((e) => e.executionTimeMs && e.executionTimeMs > 0)
        .map((e) => e.executionTimeMs!);
      const averageTime =
        executionTimes.length > 0
          ? executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length
          : null;

      const totalTokens = group.executions.reduce((sum, e) => sum + (e.tokensUsed || 0), 0);

      return {
        agentType: group.agentType,
        modelId: group.modelId,
        executionCount: totalExecutions,
        averageTime: averageTime ? Math.round(averageTime) : null,
        successRate: Math.round(successRate * 100) / 100,
        totalTokens,
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount);
}
