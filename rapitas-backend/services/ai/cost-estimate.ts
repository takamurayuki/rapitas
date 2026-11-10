/**
 * cost-estimate
 *
 * Pre-execution cost estimate for one model on a task of a given complexity:
 * the model's rate and tier from live discovery (tier table first), and the
 * token count from similar past executions. Moved out of smart-model-router.ts
 * (file size); not responsible for choosing the model.
 */
import { prisma } from '../../config/database';
import { discoverModels, type ModelTier } from './model-discovery';
import { classifyTier, inferCostPer1k } from './model-discovery/tier-classifier';
import { NOT_REVIEW_COST_ROW } from '../agents/review-cost-rows';

/**
 * Per-1K-token cost fallback used when discovery has no entry for a model.
 * The discovery layer is the source of truth — this map only catches the
 * ~edge case where a historical execution references a model id that the
 * provider has since retired.
 */
const MODEL_COST_RATES: Record<string, number> = {};

/** Tier fallback table mirroring `MODEL_COST_RATES`. Empty by design. */
const MODEL_TIERS: Record<string, 'premium' | 'standard' | 'economy' | 'free'> = {};

/** Pre-execution cost estimate. */
export type CostEstimate = {
  modelId: string;
  modelTier: string;
  estimatedTokens: number;
  estimatedCost: number;
  confidence: number;
  basedOnSamples: number;
};

/**
 * Estimate execution cost for a task based on historical data.
 *
 * @param taskComplexity - Task complexity score (0-100) / タスク複雑度スコア
 * @param modelId - Target model / 対象モデル
 * @returns Cost estimate / コスト見積もり
 */
export async function estimateCost(taskComplexity: number, modelId: string): Promise<CostEstimate> {
  // Resolve rate + tier from live discovery first; fall back to the static
  // table for legacy models that probes do not yet surface, and finally to
  // the name-based heuristic so unknown ids still produce sane numbers.
  const { models } = await discoverModels();
  const discovered = models.find((m) => m.id === modelId);
  const tier: ModelTier = discovered?.tier ?? MODEL_TIERS[modelId] ?? classifyTier(modelId);
  const rate =
    discovered?.costPer1kTokens ?? MODEL_COST_RATES[modelId] ?? inferCostPer1k(modelId, tier);

  // Fetch historical token usage for similar complexity tasks
  const similarExecutions = await prisma.agentExecution.findMany({
    where: {
      ...NOT_REVIEW_COST_ROW,
      status: 'completed',
      tokensUsed: { gt: 0 },
      session: {
        config: {
          task: {
            complexityScore: {
              gte: Math.max(0, taskComplexity - 15),
              lte: Math.min(100, taskComplexity + 15),
            },
          },
        },
      },
    },
    select: { tokensUsed: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  let estimatedTokens: number;
  let confidence: number;

  if (similarExecutions.length >= 3) {
    // Use historical average
    const avgTokens =
      similarExecutions.reduce((sum, e) => sum + e.tokensUsed, 0) / similarExecutions.length;
    estimatedTokens = Math.round(avgTokens);
    confidence = Math.min(0.9, 0.5 + similarExecutions.length * 0.04);
  } else {
    // Heuristic: complexity → token estimate
    estimatedTokens = Math.round(
      taskComplexity <= 35
        ? 5000 + taskComplexity * 100
        : taskComplexity <= 70
          ? 10000 + taskComplexity * 200
          : 20000 + taskComplexity * 500,
    );
    confidence = 0.3;
  }

  const estimatedCost = Math.round((estimatedTokens / 1000) * rate * 1000) / 1000;

  return {
    modelId,
    modelTier: tier,
    estimatedTokens,
    estimatedCost,
    confidence,
    basedOnSamples: similarExecutions.length,
  };
}
