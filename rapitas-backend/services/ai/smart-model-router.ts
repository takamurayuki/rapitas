/**
 * SmartModelRouter
 *
 * Predicts execution cost before running and auto-selects the optimal model
 * based on task complexity, historical performance, and budget constraints.
 * Routes simple tasks to cheaper/local models and complex tasks to powerful ones.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('smart-model-router');

/** Cost rate per 1K tokens (input+output average) for known models. */
const MODEL_COST_RATES: Record<string, number> = {
  'claude-opus-4-20250514': 0.025,
  'claude-opus-4-6-20250610': 0.025,
  'claude-sonnet-4-20250514': 0.006,
  'claude-sonnet-4-6-20250610': 0.006,
  'claude-haiku-4-5-20251001': 0.002,
  'claude-3-5-sonnet-20241022': 0.006,
  'gpt-4o': 0.008,
  'gpt-4o-mini': 0.001,
  'gemini-2.0-flash': 0.001,
  'ollama-local': 0,
  'llama-server-local': 0,
};

/** Model capability tiers. */
const MODEL_TIERS: Record<string, 'premium' | 'standard' | 'economy' | 'free'> = {
  'claude-opus-4-20250514': 'premium',
  'claude-opus-4-6-20250610': 'premium',
  'claude-sonnet-4-20250514': 'standard',
  'claude-sonnet-4-6-20250610': 'standard',
  'claude-haiku-4-5-20251001': 'economy',
  'claude-3-5-sonnet-20241022': 'standard',
  'gpt-4o': 'standard',
  'gpt-4o-mini': 'economy',
  'gemini-2.0-flash': 'economy',
  'ollama-local': 'free',
  'llama-server-local': 'free',
};

/** Pre-execution cost estimate. */
export type CostEstimate = {
  modelId: string;
  modelTier: string;
  estimatedTokens: number;
  estimatedCost: number;
  confidence: number;
  basedOnSamples: number;
};

/** Budget status for the current period. */
export type BudgetStatus = {
  periodStart: Date;
  periodEnd: Date;
  budgetLimit: number | null;
  spent: number;
  remaining: number | null;
  projectedMonthlySpend: number;
  executionsThisPeriod: number;
  recommendation: string;
};

/** Routing decision with explanation. */
export type RoutingDecision = {
  recommendedModel: string;
  recommendedTier: string;
  reason: string;
  alternativeModels: Array<{
    modelId: string;
    estimatedCost: number;
    tradeoff: string;
  }>;
  costEstimate: CostEstimate;
};

/**
 * Estimate execution cost for a task based on historical data.
 *
 * @param taskComplexity - Task complexity score (0-100) / タスク複雑度スコア
 * @param modelId - Target model / 対象モデル
 * @returns Cost estimate / コスト見積もり
 */
export async function estimateCost(taskComplexity: number, modelId: string): Promise<CostEstimate> {
  const rate = MODEL_COST_RATES[modelId] || MODEL_COST_RATES['default'] || 0.01;
  const tier = MODEL_TIERS[modelId] || 'standard';

  // Fetch historical token usage for similar complexity tasks
  const similarExecutions = await prisma.agentExecution.findMany({
    where: {
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

/**
 * Get the optimal model for a task based on complexity, budget, and history.
 *
 * @param taskId - Task ID / タスクID
 * @param weeklyBudget - Weekly budget in USD (null = unlimited) / 週間予算（USD）
 * @returns Routing decision with alternatives / 代替案を含むルーティング決定
 */
export async function getSmartRoute(
  taskId: number,
  weeklyBudget: number | null = null,
): Promise<RoutingDecision> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { complexityScore: true, title: true, priority: true },
  });

  const complexity = task?.complexityScore || 50;
  const isUrgent = task?.priority === 'urgent' || task?.priority === 'high';

  // Check current budget status
  const budget = await getBudgetStatus(weeklyBudget);
  const budgetPressure = budget.remaining !== null && budget.remaining < budget.spent * 0.2;

  // Determine recommended tier based on complexity + budget
  let recommendedTier: string;
  if (budgetPressure) {
    recommendedTier = complexity > 70 && isUrgent ? 'standard' : 'economy';
  } else if (complexity <= 35) {
    recommendedTier = 'economy';
  } else if (complexity <= 70) {
    recommendedTier = 'standard';
  } else {
    recommendedTier = isUrgent ? 'premium' : 'standard';
  }

  // Check if local LLM is available for economy tier
  const settings = await prisma.userSettings.findFirst();
  const hasOllama = !!settings?.ollamaUrl;
  const hasClaude = !!(settings as Record<string, unknown>)?.claudeApiKeyEncrypted;

  // Select best model for the tier
  const modelByTier: Record<string, string> = {
    premium: 'claude-opus-4-6-20250610',
    standard: 'claude-sonnet-4-6-20250610',
    economy: hasOllama ? 'ollama-local' : 'claude-haiku-4-5-20251001',
    free: 'ollama-local',
  };

  const recommendedModel = modelByTier[recommendedTier] || 'claude-sonnet-4-6-20250610';
  const costEstimate = await estimateCost(complexity, recommendedModel);

  // Generate alternatives
  const alternatives: RoutingDecision['alternativeModels'] = [];
  const tierOrder = ['free', 'economy', 'standard', 'premium'];

  for (const tier of tierOrder) {
    const model = modelByTier[tier];
    if (!model || model === recommendedModel) continue;
    // NOTE: Skip models we don't have keys for
    if (model.startsWith('claude') && !hasClaude) continue;
    if (model === 'ollama-local' && !hasOllama) continue;

    const altEstimate = await estimateCost(complexity, model);
    const tradeoff =
      tier === 'free'
        ? 'コスト0、品質は低下する可能性'
        : tier === 'economy'
          ? '低コスト、シンプルなタスク向き'
          : tier === 'standard'
            ? 'バランス型、多くのタスクに適合'
            : '最高品質、コストが高い';
    alternatives.push({
      modelId: model,
      estimatedCost: altEstimate.estimatedCost,
      tradeoff,
    });
  }

  const reason = budgetPressure
    ? `予算残高が少ないため${recommendedTier}モデルを推奨`
    : complexity <= 35
      ? `複雑度${complexity}（低）のため${recommendedTier}モデルで十分`
      : complexity > 70
        ? `複雑度${complexity}（高）のため${recommendedTier}モデルを推奨`
        : `複雑度${complexity}（中）に基づき${recommendedTier}モデルを推奨`;

  log.info(
    `[SmartRouter] Task ${taskId}: complexity=${complexity}, tier=${recommendedTier}, model=${recommendedModel}, cost=$${costEstimate.estimatedCost}`,
  );

  return {
    recommendedModel,
    recommendedTier,
    reason,
    alternativeModels: alternatives,
    costEstimate,
  };
}

/**
 * Get current budget status for the week.
 *
 * @param weeklyBudget - Weekly budget limit in USD / 週間予算上限（USD）
 * @returns Budget status / 予算状態
 */
export async function getBudgetStatus(weeklyBudget: number | null = null): Promise<BudgetStatus> {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const executions = await prisma.agentExecution.findMany({
    where: {
      status: 'completed',
      tokensUsed: { gt: 0 },
      completedAt: { gte: weekStart },
    },
    include: { agentConfig: { select: { modelId: true } } },
  });

  let spent = 0;
  for (const exec of executions) {
    const modelId = exec.agentConfig?.modelId || 'default';
    const rate = MODEL_COST_RATES[modelId] || 0.01;
    spent += (exec.tokensUsed / 1000) * rate;
  }
  spent = Math.round(spent * 100) / 100;

  const daysElapsed = Math.max(1, (now.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000));
  const projectedMonthlySpend = Math.round((spent / daysElapsed) * 30 * 100) / 100;

  const recommendation =
    weeklyBudget && spent > weeklyBudget * 0.8
      ? '⚠️ 予算の80%を超えました。ローカルLLMへの切り替えを推奨します'
      : weeklyBudget && spent > weeklyBudget * 0.5
        ? '💡 予算の半分を消費。シンプルなタスクにはHaikuやローカルLLMの利用を検討してください'
        : '✅ 予算内で順調に推移しています';

  return {
    periodStart: weekStart,
    periodEnd: weekEnd,
    budgetLimit: weeklyBudget,
    spent,
    remaining: weeklyBudget ? Math.max(0, weeklyBudget - spent) : null,
    projectedMonthlySpend,
    executionsThisPeriod: executions.length,
    recommendation,
  };
}
