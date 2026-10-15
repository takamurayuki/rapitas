/**
 * Cost Optimization Query
 *
 * Provides getCostOptimizationInsights, which compares per-model execution
 * cost and suggests cheaper substitutes. Cost-per-execution prefers the
 * recorded `AgentExecution.costUsd` (parsed from the CLI's stream-json usage
 * block — the authoritative figure shown everywhere else, e.g. the
 * self-observation summary and agent-usage-summary routes) and only falls
 * back to the hardcoded per-1k-token rate table below when no recorded cost
 * exists (legacy rows from before cost recording was added). This keeps the
 * number on this endpoint identical to the number shown elsewhere for the
 * same execution, instead of silently re-deriving a second, drifting figure
 * from a rate table that goes stale as provider pricing changes.
 */

import { prisma } from '../../../../../config/database';
import { toInt } from '../../metric-coercion';
import type {
  ModelCostStats,
  CostOptimizationInsights,
  ComparableExecution,
} from './cost-optimization-types';
import { resolveExecutionCost } from './cost-optimization-cost-resolver';
import { buildSegmentSuggestions } from './cost-optimization-suggestions';

/**
 * Compares recent executions grouped by the model actually invoked and
 * suggests cheaper substitutes where success rate is not meaningfully worse.
 *
 * Groups by `AgentExecution.modelName` (the model the CLI actually ran,
 * recorded from the stream-json usage block) — NOT `agentConfig.modelId`,
 * which is the statically-configured model and is identical across rows once
 * Smart Router / auto selection is in play, collapsing every execution into
 * one bucket. Failed and null-model rows are intentionally NOT filtered out:
 * `successRate` is `completed` count over the full denominator, so excluding
 * failures would pin every model at 100% and starve the suggestion engine.
 *
 * @returns Cost optimization insights / コスト最適化インサイト
 */
export async function getCostOptimizationInsights(): Promise<CostOptimizationInsights> {
  // Mirror usage-breakdown-query's fetch path: select modelName directly and
  // skip status/token pre-filters so failures and null-model rows still count.
  const executions = await prisma.agentExecution.findMany({
    select: {
      status: true,
      modelName: true,
      tokensUsed: true,
      costUsd: true,
      executionTimeMs: true,
      session: {
        select: {
          mode: true,
          config: { select: { task: { select: { complexityScore: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const modelMap = new Map<
    string,
    { total: number; success: number; tokens: number; time: number; costs: number }
  >();

  for (const exec of executions) {
    const model = exec.modelName ?? 'unknown';
    const tokens = toInt(exec.tokensUsed);
    const cost = resolveExecutionCost(exec.costUsd, tokens, model);

    const existing = modelMap.get(model) || {
      total: 0,
      success: 0,
      tokens: 0,
      time: 0,
      costs: 0,
    };
    existing.total++;
    if (exec.status === 'completed') existing.success++;
    existing.tokens += tokens;
    existing.time += toInt(exec.executionTimeMs);
    existing.costs += cost;
    modelMap.set(model, existing);
  }

  const modelStats: ModelCostStats[] = Array.from(modelMap.entries()).map(([model, s]) => ({
    model,
    executions: s.total,
    successCount: s.success,
    successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
    totalTokens: s.tokens,
    avgTokens: s.total > 0 ? Math.round(s.tokens / s.total) : 0,
    avgTimeMs: s.total > 0 ? Math.round(s.time / s.total) : 0,
    estimatedCost: Math.round(s.costs * 100) / 100,
  }));

  const suggestions = buildSegmentSuggestions(executions as ComparableExecution[]);

  const totalCost = modelStats.reduce((sum, s) => sum + s.estimatedCost, 0);
  const totalTokens = modelStats.reduce((sum, s) => sum + s.totalTokens, 0);

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    totalTokens,
    totalExecutions: executions.length,
    modelBreakdown: modelStats,
    suggestions,
  };
}
