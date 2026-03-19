import { Elysia } from 'elysia';
import { PrismaClient, Prisma } from '@prisma/client';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:agent-metrics');

const prisma = new PrismaClient();

type ExecutionWhereInput = Prisma.AgentExecutionWhereInput;

export interface AgentMetrics {
  agentId: number;
  agentName: string;
  agentType: string;
  modelId: string | null;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  averageExecutionTimeMs: number | null;
  totalTokensUsed: number;
  averageTokensPerExecution: number | null;
  lastExecutionAt: Date | null;
  isActive: boolean;
}

export interface ExecutionTrendData {
  date: string;
  successful: number;
  failed: number;
  totalTokens: number;
  averageTime: number | null;
}

export interface AgentPerformanceComparison {
  agentType: string;
  modelId: string;
  executionCount: number;
  averageTime: number | null;
  successRate: number;
  totalTokens: number;
}

export interface MetricsOverview {
  totalExecutions: number;
  totalSuccessful: number;
  totalFailed: number;
  overallSuccessRate: number;
  totalTokensUsed: number;
  totalAgents: number;
  activeAgents: number;
  averageExecutionTime: number | null;
}

export interface DateRange {
  startDate?: string;
  endDate?: string;
  period?: 'day' | 'week' | 'month';
}

/**
 * Retrieves detailed metrics for each agent within an optional date range.
 */
async function getAgentMetrics(dateRange?: DateRange): Promise<AgentMetrics[]> {
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
 */
async function getExecutionTrends(
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
 * Compares performance across agent type + model combinations.
 */
async function getAgentPerformanceComparison(
  dateRange?: DateRange,
): Promise<AgentPerformanceComparison[]> {
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

/**
 * Returns a high-level overview of all agent execution metrics.
 */
async function getMetricsOverview(dateRange?: DateRange): Promise<MetricsOverview> {
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

export const agentMetricsRouter = new Elysia({ prefix: '/agent-metrics' })

  .get('/', async ({ query }) => {
    try {
      const dateRange: DateRange = {
        startDate: query.startDate as string,
        endDate: query.endDate as string,
        period: query.period as 'day' | 'week' | 'month',
      };

      const metrics = await getAgentMetrics(dateRange);
      return { metrics };
    } catch (error) {
      log.error({ err: error }, 'Error fetching agent metrics');
      return { error: 'Failed to fetch agent metrics' };
    }
  })

  .get('/overview', async ({ query }) => {
    try {
      const dateRange: DateRange = {
        startDate: query.startDate as string,
        endDate: query.endDate as string,
        period: query.period as 'day' | 'week' | 'month',
      };

      const overview = await getMetricsOverview(dateRange);
      return overview;
    } catch (error) {
      log.error({ err: error }, 'Error fetching metrics overview');
      return { error: 'Failed to fetch metrics overview' };
    }
  })

  .get('/trends', async ({ query }) => {
    try {
      const period = (query.period as 'day' | 'week' | 'month') || 'day';
      const days = parseInt(query.days as string) || 30;

      const trends = await getExecutionTrends(period, days);
      return { trends };
    } catch (error) {
      log.error({ err: error }, 'Error fetching execution trends');
      return { error: 'Failed to fetch execution trends' };
    }
  })

  .get('/performance', async ({ query }) => {
    try {
      const dateRange: DateRange = {
        startDate: query.startDate as string,
        endDate: query.endDate as string,
        period: query.period as 'day' | 'week' | 'month',
      };

      const performance = await getAgentPerformanceComparison(dateRange);
      return { performance };
    } catch (error) {
      log.error({ err: error }, 'Error fetching agent performance');
      return { error: 'Failed to fetch agent performance comparison' };
    }
  })

  .get('/:agentId', async ({ params, query }) => {
    try {
      const agentId = parseInt(params.agentId);
      const dateRange: DateRange = {
        startDate: query.startDate as string,
        endDate: query.endDate as string,
        period: query.period as 'day' | 'week' | 'month',
      };

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

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
        include: {
          executions: {
            where: whereClause,
            include: {
              executionLogs: {
                select: {
                  logType: true,
                  logChunk: true,
                  timestamp: true,
                },
                orderBy: {
                  sequenceNumber: 'asc',
                },
                take: 100,
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 50,
          },
        },
      });

      if (!agent) {
        return { error: 'Agent not found' };
      }

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

      return {
        agent: {
          id: agent.id,
          name: agent.name,
          agentType: agent.agentType,
          modelId: agent.modelId,
          isActive: agent.isActive,
        },
        metrics: {
          totalExecutions,
          successfulExecutions,
          failedExecutions,
          successRate: Math.round(successRate * 100) / 100,
          averageExecutionTimeMs: averageExecutionTime ? Math.round(averageExecutionTime) : null,
          totalTokensUsed: totalTokens,
          averageTokensPerExecution: averageTokensPerExecution
            ? Math.round(averageTokensPerExecution)
            : null,
        },
        recentExecutions: executions.map((e) => ({
          id: e.id,
          status: e.status,
          startedAt: e.startedAt,
          completedAt: e.completedAt,
          executionTimeMs: e.executionTimeMs,
          tokensUsed: e.tokensUsed,
          errorMessage: e.errorMessage,
          command: e.command,
        })),
      };
    } catch (error) {
      log.error({ err: error }, 'Error fetching agent detail metrics');
      return { error: 'Failed to fetch agent detail metrics' };
    }
  })

  /**
   * Cost optimization insights — compares model performance and suggests cost savings.
   */
  .get('/cost-optimization', async () => {
    try {
      const executions = await prisma.agentExecution.findMany({
        where: { status: 'completed', tokensUsed: { gt: 0 } },
        include: {
          agentConfig: { select: { modelId: true, agentType: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      // NOTE: Token cost rates per 1K tokens (input+output average estimate)
      const costPer1kTokens: Record<string, number> = {
        'claude-opus-4-20250514': 0.025,
        'claude-sonnet-4-20250514': 0.006,
        'claude-haiku-4-5-20251001': 0.002,
        'claude-3-5-sonnet-20241022': 0.006,
        default: 0.010,
      };

      type ModelStats = {
        model: string;
        executions: number;
        successCount: number;
        successRate: number;
        totalTokens: number;
        avgTokens: number;
        avgTimeMs: number;
        estimatedCost: number;
      };

      const modelMap = new Map<string, { total: number; success: number; tokens: number; time: number; costs: number }>();

      for (const exec of executions) {
        const modelId = exec.agentConfig?.modelId || 'unknown';
        const rate = costPer1kTokens[modelId] || costPer1kTokens['default'];
        const cost = (exec.tokensUsed / 1000) * rate;

        const existing = modelMap.get(modelId) || { total: 0, success: 0, tokens: 0, time: 0, costs: 0 };
        existing.total++;
        if (exec.status === 'completed') existing.success++;
        existing.tokens += exec.tokensUsed;
        existing.time += exec.executionTimeMs || 0;
        existing.costs += cost;
        modelMap.set(modelId, existing);
      }

      const modelStats: ModelStats[] = Array.from(modelMap.entries()).map(([model, s]) => ({
        model,
        executions: s.total,
        successCount: s.success,
        successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
        totalTokens: s.tokens,
        avgTokens: s.total > 0 ? Math.round(s.tokens / s.total) : 0,
        avgTimeMs: s.total > 0 ? Math.round(s.time / s.total) : 0,
        estimatedCost: Math.round(s.costs * 100) / 100,
      }));

      // Generate optimization suggestions
      const suggestions: string[] = [];
      const sorted = [...modelStats].sort((a, b) => b.estimatedCost - a.estimatedCost);

      if (sorted.length >= 2) {
        const expensive = sorted[0];
        const cheaper = sorted.find(
          (s) => s.model !== expensive.model && s.successRate >= expensive.successRate * 0.9,
        );
        if (cheaper) {
          const savings = expensive.estimatedCost - cheaper.estimatedCost;
          suggestions.push(
            `${expensive.model}の代わりに${cheaper.model}を使用すると、成功率を維持しながら$${savings.toFixed(2)}の削減が見込めます`,
          );
        }
      }

      const totalCost = modelStats.reduce((sum, s) => sum + s.estimatedCost, 0);
      const totalTokens = modelStats.reduce((sum, s) => sum + s.totalTokens, 0);

      return {
        success: true,
        data: {
          totalCost: Math.round(totalCost * 100) / 100,
          totalTokens,
          totalExecutions: executions.length,
          modelBreakdown: modelStats,
          suggestions,
        },
      };
    } catch (error) {
      log.error({ err: error }, 'Error generating cost optimization insights');
      return { error: 'Failed to generate cost optimization insights' };
    }
  });
