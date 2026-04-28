/**
 * Agent Usage Summary Routes
 *
 * Provides per-agent usage and configured execution limits for the AI agent
 * management page. Values are derived from AgentExecution and
 * AgentExecutionConfig records; no mock data is returned.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:agent-usage-summary');

function monthRange(now = new Date()) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

function formatPeriod(date: Date): string {
  return `${date.getFullYear()}/${date.getMonth() + 1}`;
}

export const agentUsageSummaryRouter = new Elysia().get('/agent-usage-summary', async () => {
  try {
    const now = new Date();
    const period = monthRange(now);

    const [agents, totalMonthlyUsage] = await Promise.all([
      prisma.aIAgentConfig.findMany({
        orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        include: {
          executions: {
            where: { createdAt: { gte: period.start, lte: period.end } },
            select: {
              status: true,
              tokensUsed: true,
              inputTokens: true,
              outputTokens: true,
              cacheReadInputTokens: true,
              cacheCreationInputTokens: true,
              costUsd: true,
              executionTimeMs: true,
              createdAt: true,
              completedAt: true,
            },
          },
          agentExecutionConfigs: {
            select: {
              timeoutMs: true,
              maxRetries: true,
              parallelExecution: true,
              maxConcurrentAgents: true,
              requireApproval: true,
              autoCreatePR: true,
              autoMergePR: true,
            },
          },
          _count: {
            select: { executions: true, agentExecutionConfigs: true, workflowRoles: true },
          },
        },
      }),
      prisma.agentExecution.aggregate({
        where: { createdAt: { gte: period.start, lte: period.end } },
        _sum: {
          tokensUsed: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadInputTokens: true,
          cacheCreationInputTokens: true,
        },
      }),
    ]);

    const totalMonthlyTokens =
      (totalMonthlyUsage._sum.tokensUsed ?? 0) +
      (totalMonthlyUsage._sum.inputTokens ?? 0) +
      (totalMonthlyUsage._sum.outputTokens ?? 0) +
      (totalMonthlyUsage._sum.cacheReadInputTokens ?? 0) +
      (totalMonthlyUsage._sum.cacheCreationInputTokens ?? 0);

    const summaries = agents.map((agent) => {
      const executions = agent.executions;
      const configs = agent.agentExecutionConfigs;
      const realTokenTotal = executions.reduce(
        (sum, execution) =>
          sum +
          execution.inputTokens +
          execution.outputTokens +
          execution.cacheReadInputTokens +
          execution.cacheCreationInputTokens,
        0,
      );
      const fallbackTokenTotal = executions.reduce(
        (sum, execution) => sum + execution.tokensUsed,
        0,
      );
      const tokensUsed = realTokenTotal > 0 ? realTokenTotal : fallbackTokenTotal;
      const totalCostUsd = executions.reduce(
        (sum, execution) => sum + Number(execution.costUsd),
        0,
      );
      const timedExecutions = executions.filter(
        (execution) => execution.executionTimeMs && execution.executionTimeMs > 0,
      );
      const averageExecutionTimeMs =
        timedExecutions.length > 0
          ? Math.round(
              timedExecutions.reduce(
                (sum, execution) => sum + (execution.executionTimeMs ?? 0),
                0,
              ) / timedExecutions.length,
            )
          : null;
      const lastExecutionAt = executions
        .map((execution) => execution.completedAt ?? execution.createdAt)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      return {
        agent: {
          id: agent.id,
          name: agent.name,
          agentType: agent.agentType,
          modelId: agent.modelId,
          isActive: agent.isActive,
          isDefault: agent.isDefault,
          isInstalled: agent.isInstalled,
          hasApiKey: Boolean(agent.apiKeyEncrypted),
        },
        usage: {
          period: formatPeriod(now),
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
          executionCount: executions.length,
          completedCount: executions.filter((execution) => execution.status === 'completed').length,
          failedCount: executions.filter((execution) => execution.status === 'failed').length,
          runningCount: executions.filter((execution) => execution.status === 'running').length,
          tokensUsed,
          inputTokens: executions.reduce((sum, execution) => sum + execution.inputTokens, 0),
          outputTokens: executions.reduce((sum, execution) => sum + execution.outputTokens, 0),
          cacheReadTokens: executions.reduce(
            (sum, execution) => sum + execution.cacheReadInputTokens,
            0,
          ),
          cacheCreationTokens: executions.reduce(
            (sum, execution) => sum + execution.cacheCreationInputTokens,
            0,
          ),
          totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
          averageExecutionTimeMs,
          monthlyTokenSharePct:
            totalMonthlyTokens > 0
              ? Math.round((tokensUsed / totalMonthlyTokens) * 10000) / 100
              : 0,
          lastExecutionAt: lastExecutionAt?.toISOString() ?? null,
        },
        limits: {
          assignedTaskConfigCount: agent._count.agentExecutionConfigs,
          workflowRoleCount: agent._count.workflowRoles,
          maxTimeoutMs:
            configs.length > 0 ? Math.max(...configs.map((config) => config.timeoutMs)) : null,
          maxRetries:
            configs.length > 0 ? Math.max(...configs.map((config) => config.maxRetries)) : null,
          maxConcurrentAgents:
            configs.length > 0
              ? Math.max(...configs.map((config) => config.maxConcurrentAgents))
              : null,
          parallelExecutionEnabledCount: configs.filter((config) => config.parallelExecution)
            .length,
          requireApprovalModes: Array.from(
            new Set(configs.map((config) => config.requireApproval)),
          ).sort(),
          autoCreatePrEnabledCount: configs.filter((config) => config.autoCreatePR).length,
          autoMergePrEnabledCount: configs.filter((config) => config.autoMergePR).length,
        },
        totals: {
          allTimeExecutionCount: agent._count.executions,
        },
      };
    });

    return { period: formatPeriod(now), totalMonthlyTokens, agents: summaries };
  } catch (error) {
    log.error({ err: error }, 'Error fetching per-agent usage summary');
    return { period: formatPeriod(new Date()), totalMonthlyTokens: 0, agents: [] };
  }
});
