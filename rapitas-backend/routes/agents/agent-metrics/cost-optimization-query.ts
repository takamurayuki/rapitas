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

import { prisma } from '../../../config/database';

/** Per-model breakdown of execution cost, volume, and success rate. */
export interface ModelCostStats {
  model: string;
  executions: number;
  successCount: number;
  successRate: number;
  totalTokens: number;
  avgTokens: number;
  avgTimeMs: number;
  estimatedCost: number;
}

export interface CostOptimizationInsights {
  totalCost: number;
  totalTokens: number;
  totalExecutions: number;
  modelBreakdown: ModelCostStats[];
  suggestions: string[];
}

/**
 * Fallback rate table (USD per 1K tokens, blended input+output estimate).
 * Only used when an execution has no recorded `costUsd` — e.g. rows written
 * before cost recording landed. Keep in sync with provider pricing pages;
 * going stale only affects the fallback, never rows with a recorded cost.
 */
const FALLBACK_COST_PER_1K_TOKENS: Record<string, number> = {
  'claude-opus-4-20250514': 0.025,
  'claude-sonnet-4-20250514': 0.006,
  'claude-haiku-4-5-20251001': 0.002,
  'claude-3-5-sonnet-20241022': 0.006,
  default: 0.01,
};

/**
 * Resolve the USD cost of a single execution: prefer the recorded value,
 * fall back to the rate-table estimate only when nothing was recorded.
 *
 * @param recordedCostUsd - `AgentExecution.costUsd` (Prisma Decimal) / 記録済みコスト
 * @param tokensUsed - `AgentExecution.tokensUsed` / 使用トークン数
 * @param modelId - Model id used for the fallback rate lookup / フォールバック用モデルID
 * @returns Cost in USD / 実行コスト（USD）
 */
function resolveExecutionCost(
  recordedCostUsd: unknown,
  tokensUsed: number,
  modelId: string,
): number {
  const recorded = Number(recordedCostUsd);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  const rate = FALLBACK_COST_PER_1K_TOKENS[modelId] ?? FALLBACK_COST_PER_1K_TOKENS['default'];
  return (tokensUsed / 1000) * rate;
}

/**
 * Compares recent completed executions across models and suggests cheaper
 * substitutes where success rate is not meaningfully worse.
 *
 * @returns Cost optimization insights / コスト最適化インサイト
 */
export async function getCostOptimizationInsights(): Promise<CostOptimizationInsights> {
  const executions = await prisma.agentExecution.findMany({
    where: { status: 'completed', tokensUsed: { gt: 0 } },
    include: {
      agentConfig: { select: { modelId: true, agentType: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const modelMap = new Map<
    string,
    { total: number; success: number; tokens: number; time: number; costs: number }
  >();

  for (const exec of executions) {
    const modelId = exec.agentConfig?.modelId || 'unknown';
    const cost = resolveExecutionCost(exec.costUsd, exec.tokensUsed, modelId);

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

  const suggestions = buildSuggestions(modelStats);

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

/**
 * Generates human-readable cost-saving suggestions by comparing the most
 * expensive model against a cheaper one with comparable success rate.
 *
 * @param modelStats - Per-model cost stats / モデル別コスト統計
 * @returns Suggestion strings (Japanese) / 提案文（日本語）
 */
function buildSuggestions(modelStats: ModelCostStats[]): string[] {
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

  return suggestions;
}
