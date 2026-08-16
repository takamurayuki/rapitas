/**
 * Agent Metrics Router
 *
 * Elysia route definitions for the /agent-metrics endpoint group. Delegates all
 * database access to query functions in queries.ts and all type definitions to
 * types.ts. Does not contain business logic.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { getAgentMetrics, getExecutionTrends, getMetricsOverview } from './queries';
import { getAgentPerformanceComparison } from './performance-query';
import { getSelfObservationSummary } from './observation-query';
import { getAgentUsageBreakdown } from './usage-breakdown-query';
import { getAgentUtilization } from './utilization-query';
import { getUsdJpyRate } from './currency-config';
import { getCostOptimizationInsights } from './cost-optimization-query';
import { getRepairConvergenceStats } from './repair-convergence-query';
import { computeGrowthLedgerMetrics } from '../../../services/self-improvement/growth-ledger-metrics';
import { readJudgeEvalResult } from '../../../services/observability/eval-judge-results';
import type { DateRange } from './types';

const log = createLogger('routes:agent-metrics');

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

  /**
   * Self-observation snapshot: cost trend, cache hit rate, model mix, error
   * rate. Powers the in-app self-observation widget.
   */
  .get('/observation', async ({ query }) => {
    try {
      const days = Math.min(90, Math.max(1, parseInt(query.days as string) || 14));
      const summary = await getSelfObservationSummary(days);
      return summary;
    } catch (error) {
      log.error({ err: error }, 'Error fetching self-observation summary');
      return { error: 'Failed to fetch self-observation summary' };
    }
  })

  /**
   * Display config for usage views — currently the USD→JPY rate so every
   * usage widget converts recorded USD costs to yen consistently.
   */
  .get('/usage-config', () => ({ usdJpyRate: getUsdJpyRate() }))

  /**
   * Per-role usage breakdown: cost / tokens / cache effectiveness grouped by
   * the workflow role that ran each execution. Powers the agent usage widget.
   */
  .get('/usage-breakdown', async ({ query }) => {
    try {
      const days = Math.min(90, Math.max(1, parseInt(query.days as string) || 14));
      return await getAgentUsageBreakdown(days);
    } catch (error) {
      log.error({ err: error }, 'Error fetching agent usage breakdown');
      return { error: 'Failed to fetch agent usage breakdown' };
    }
  })

  /**
   * Per-role / per-CLI-agent daily busy ratio (interval union / day length,
   * 0..1). Powers the utilization time-series cards on the metrics page.
   */
  .get('/utilization', async ({ query }) => {
    try {
      const { startDate, endDate } = parseDateRange(query);
      return await getAgentUtilization({ startDate, endDate });
    } catch (error) {
      log.error({ err: error }, 'Error fetching agent utilization');
      return { error: 'Failed to fetch utilization' };
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
      const data = await getCostOptimizationInsights();
      return { success: true, data };
    } catch (error) {
      log.error({ err: error }, 'Error generating cost optimization insights');
      return { error: 'Failed to generate cost optimization insights' };
    }
  })

  /**
   * Verify-repair loop convergence: how often the self-repair bounce
   * (verify -> implement -> verify) eventually converges vs leaves a task
   * blocked, and how many iterations convergence takes.
   */
  .get('/repair-convergence', async () => {
    try {
      const data = await getRepairConvergenceStats();
      return { success: true, data };
    } catch (error) {
      log.error({ err: error }, 'Error computing repair convergence stats');
      return { error: 'Failed to compute repair convergence stats' };
    }
  })

  /**
   * Weekly self-growth ledger for the /agents/growth dashboard: autonomous
   * completion rate, critic first-pass rate, repair efficiency, defect
   * recurrence rate and KB validated ratio, bucketed into rolling windows.
   */
  .get('/growth-ledger', async ({ query }) => {
    try {
      const windowDays = Math.min(30, Math.max(1, parseInt(query.windowDays as string) || 7));
      const windowCount = Math.min(26, Math.max(1, parseInt(query.windowCount as string) || 12));
      const data = await computeGrowthLedgerMetrics({ windowDays, windowCount });
      return { success: true, data };
    } catch (error) {
      log.error({ err: error }, 'Error computing growth ledger metrics');
      return { error: 'Failed to compute growth ledger metrics' };
    }
  })

  /**
   * Latest adversarial-judge accuracy eval snapshot (scripts/eval-judge.ts,
   * opt-in RAPITAS_EVAL_JUDGE=1). `data` is null when the eval has never run.
   */
  .get('/judge-eval', ({ set }) => {
    try {
      const data = readJudgeEvalResult();
      return { success: true, data };
    } catch (error) {
      log.error({ err: error }, 'Error reading judge eval result');
      set.status = 500;
      return { success: false, data: null };
    }
  });
