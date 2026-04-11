/**
 * Agent Metrics Router
 *
 * Elysia route definitions for the /agent-metrics endpoint group. Delegates all
 * database access to query functions in queries.ts and all type definitions to
 * types.ts. Does not contain business logic.
 */

import { Elysia } from 'elysia';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../../config/logger';
import { getAgentMetrics, getExecutionTrends, getMetricsOverview } from './queries';
import { getAgentPerformanceComparison } from './performance-query';
import type { DateRange } from './types';

const log = createLogger('routes:agent-metrics');

// NOTE: Separate PrismaClient instance for the /:agentId detail route which
// requires a richer include shape not covered by the shared query helpers.
const prisma = new PrismaClient();

/**
 * Extracts a DateRange object from Elysia query parameters.
 *
 * @param query - Raw query object from Elysia context / Elysiaのクエリオブジェクト
 * @returns Typed DateRange / 型付きのDateRange
 */
function parseDateRange(query: Record<string, unknown>): DateRange {
  return {
    startDate: query.startDate as string,
    endDate: query.endDate as string,
    period: query.period as 'day' | 'week' | 'month',
  };
}

export const agentMetricsRouter = new Elysia({ prefix: '/agent-metrics' })

  .get('/', async ({ query }) => {
    try {
      const metrics = await getAgentMetrics(parseDateRange(query));
      return { metrics };
    } catch (error) {
      log.error({ err: error }, 'Error fetching agent metrics');
      return { error: 'Failed to fetch agent metrics' };
    }
  })

  .get('/overview', async ({ query }) => {
    try {
      const overview = await getMetricsOverview(parseDateRange(query));
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
      const performance = await getAgentPerformanceComparison(parseDateRange(query));
      return { performance };
    } catch (error) {
      log.error({ err: error }, 'Error fetching agent performance');
      return { error: 'Failed to fetch agent performance comparison' };
    }
  })

  .get('/:agentId', async ({ params, query }) => {
    try {
      const agentId = parseInt(params.agentId);
      const dateRange = parseDateRange(query);

      const whereClause: { createdAt?: { gte?: Date; lte?: Date } } = {};
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
        default: 0.01,
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

      const modelMap = new Map<
        string,
        { total: number; success: number; tokens: number; time: number; costs: number }
      >();

      for (const exec of executions) {
        const modelId = exec.agentConfig?.modelId || 'unknown';
        const rate = costPer1kTokens[modelId] || costPer1kTokens['default'];
        const cost = (exec.tokensUsed / 1000) * rate;

        const existing = modelMap.get(modelId) || {
          total: 0,
          success: 0,
          tokens: 0,
          time: 0,
          costs: 0,
        };
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
