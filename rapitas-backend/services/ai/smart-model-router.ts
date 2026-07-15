/**
 * SmartModelRouter
 *
 * Predicts execution cost before running and auto-selects the optimal model
 * based on task complexity, historical performance, and budget constraints.
 *
 * Model availability and the per-tier candidate pool are sourced dynamically
 * from `services/ai/model-discovery` — no model id is hardcoded in this
 * file, so new releases (Opus 5, Gemini 3 Pro, GPT-5, …) are picked up
 * automatically as soon as the underlying provider exposes them.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  discoverModels,
  selectBestModel,
  type DiscoveredModel,
  type ModelTier,
  type Provider,
} from './model-discovery';
import { classifyTier, inferCostPer1k } from './model-discovery/tier-classifier';
import { listActiveCooldowns } from './provider-cooldown';

const log = createLogger('smart-model-router');

/**
 * Per-1K-token cost fallback used when discovery has no entry for a model.
 * The discovery layer is the source of truth — this map only catches the
 * ~edge case where a historical execution references a model id that the
 * provider has since retired.
 */
const MODEL_COST_RATES: Record<string, number> = {};

/** Tier fallback table mirroring `MODEL_COST_RATES`. Empty by design. */
const MODEL_TIERS: Record<string, 'premium' | 'standard' | 'economy' | 'free'> = {};

/** Highest → lowest capability. Index 0 is the strongest tier. */
const TIER_ORDER: ModelTier[] = ['premium', 'standard', 'economy', 'free'];

/** Provider label shown in trade-off strings. */
const PROVIDER_LABEL: Record<'claude' | 'openai' | 'gemini' | 'ollama', string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama (ローカル)',
};

/**
 * Coerce a recorded AgentExecution.costUsd (Prisma Decimal | number | string,
 * incl. legacy double-JSON-encoded strings like `"\"0.5\""`) to a number.
 *
 * @param v - Raw column value / 生のカラム値
 * @returns Finite non-negative number, 0 when unparseable / パース不能時は0
 */
function coerceCostUsd(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
  const n = parseFloat(String(v).replace(/"/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

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
/** Optional inputs that shape automatic model selection. */
export interface SmartRouteOptions {
  weeklyBudget?: number | null;
  /** Tiebreaker preference within the chosen tier. */
  preferredProvider?: Provider;
  /**
   * Providers to drop from the candidate pool before selection. Used by the
   * orchestrator to realise cross-provider review (exclude the upstream phase
   * provider when picking for reviewer/verifier).
   */
  excludeProviders?: Provider[];
  /**
   * Minimum capability tier (a role floor). The complexity/budget tier is
   * RAISED up to this — never below it — so capability-critical phases
   * (implementer writing code, reviewer/verifier judging it) are not run on an
   * economy model just because the task scored low complexity.
   */
  minTier?: ModelTier;
  /**
   * When false, skip building the (DB-heavy) `alternativeModels` list — it costs
   * one `estimateCost` query per discovered model and is only used by the UI
   * cost-explorer, NOT by the orchestrator's decision. Default true.
   */
  includeAlternatives?: boolean;
  /**
   * Evidence-proven cheaper tier for the role being routed (role-evidence.ts).
   * LOWERS the complexity/budget tier toward it — by at most ONE step per
   * decision, and never below `minTier` — so proven-cheap models are actually
   * chosen instead of the heuristic always paying for the safe default.
   * Callers must not pass this when escalation/risk floors are active.
   */
  capTier?: ModelTier;
}

export async function getSmartRoute(
  taskId: number,
  options: SmartRouteOptions | number | null = {},
): Promise<RoutingDecision> {
  // NOTE: Backwards-compat: previously the second arg was `weeklyBudget`.
  // Accept both calling styles so existing callers keep working.
  const opts: SmartRouteOptions =
    typeof options === 'number' || options === null ? { weeklyBudget: options } : options;
  const weeklyBudget = opts.weeklyBudget ?? null;
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
  } else if (complexity > 85) {
    // Very high complexity forces premium regardless of urgency: a standard
    // model failing here re-runs through the verify/adversarial repair loop,
    // which costs MORE tokens than a premium first attempt (escalation would
    // force premium on the retry anyway — pay once, not twice).
    recommendedTier = 'premium';
  } else {
    recommendedTier = isUrgent ? 'premium' : 'standard';
  }

  // Evidence cap: when a cheaper tier has a proven success record for this
  // role, lower the heuristic tier toward it — at most ONE step per decision
  // so a high-complexity task never jumps straight from premium to economy on
  // evidence gathered mostly from smaller tasks.
  let evidenceApplied = false;
  if (opts.capTier) {
    const rec = TIER_ORDER.indexOf(recommendedTier as ModelTier);
    const cap = TIER_ORDER.indexOf(opts.capTier);
    if (cap > rec) {
      recommendedTier = TIER_ORDER[Math.min(cap, rec + 1)];
      evidenceApplied = true;
    }
  }

  // Role floor: raise (never lower) the tier to the caller's minimum so
  // capability-critical phases don't run on an economy model on a low-complexity
  // task. Applied AFTER the evidence cap — floors always win. TIER_ORDER
  // index 0 = highest capability.
  if (opts.minTier) {
    if (TIER_ORDER.indexOf(recommendedTier as ModelTier) > TIER_ORDER.indexOf(opts.minTier)) {
      recommendedTier = opts.minTier;
      evidenceApplied = false;
    }
  }

  // Run the dynamic discovery layer: probes CLI/API surfaces of every
  // configured provider and returns whatever models they advertise right now.
  const discovery = await discoverModels();

  // Merge any provider currently in cooldown (quota / rate-limit / auth
  // failure) into excludeProviders so we don't recommend a model that we
  // know is going to fail. This is what powers automatic provider fallback
  // when a previous attempt hit "usage limit" or similar.
  const cooldownProviders = listActiveCooldowns().map((c) => c.provider);
  const mergedExcludes = Array.from(
    new Set([...(opts.excludeProviders ?? []), ...cooldownProviders]),
  );

  // Pick the best model for the desired tier (with automatic downgrade
  // through premium → standard → economy → free) using the discovery output.
  const selected = await selectBestModel({
    desiredTier: recommendedTier as ModelTier,
    preferFree: budgetPressure,
    preferredProvider: opts.preferredProvider,
    excludeProviders: mergedExcludes,
  });
  const recommendedModel = selected?.model.id ?? null;
  if (selected) recommendedTier = selected.tier;

  const tradeoffLabel = (m: DiscoveredModel): string => {
    const tier =
      m.tier === 'free'
        ? 'コスト0、品質は低下する可能性'
        : m.tier === 'economy'
          ? '低コスト、シンプルなタスク向き'
          : m.tier === 'standard'
            ? 'バランス型、多くのタスクに適合'
            : '最高品質、コストが高い';
    return `${PROVIDER_LABEL[m.provider]} ${m.tier}: ${tier}`;
  };

  // Build cross-provider alternatives from the same discovered set. Skipped on
  // the orchestrator hot path (includeAlternatives:false) — each entry costs a
  // DB query and only the UI cost-explorer consumes the list.
  const alternatives: RoutingDecision['alternativeModels'] = [];
  if (opts.includeAlternatives !== false) {
    for (const m of discovery.models) {
      if (m.id === recommendedModel) continue;
      const est = await estimateCost(complexity, m.id);
      alternatives.push({
        modelId: m.id,
        estimatedCost: est.estimatedCost,
        tradeoff: tradeoffLabel(m),
      });
    }
    // `alternatives` is an informational display list attached to the decision
    // (cheapest-first), not the selected route — equal-cost reordering has no
    // effect on which model is actually chosen or on any prompt.
    // determinism-ok: display-only alternatives list, not the selected route.
    alternatives.sort((a, b) => a.estimatedCost - b.estimatedCost);
  }

  // Last-resort fallback: nothing was discovered. Prefer any discovered model;
  // else the bare 'sonnet' ALIAS — the CLI resolves it to the current Sonnet
  // release, so this never goes stale the way a pinned versioned id
  // ('claude-sonnet-4-6') did once that release was retired.
  const finalModel = recommendedModel ?? discovery.models[0]?.id ?? 'sonnet';
  const costEstimate = await estimateCost(complexity, finalModel);

  const reason = evidenceApplied
    ? `直近の実行実績でこのロールは${recommendedTier}モデルの成功率が高いため引き下げ`
    : budgetPressure
      ? `予算残高が少ないため${recommendedTier}モデルを推奨`
      : complexity <= 35
        ? `複雑度${complexity}（低）のため${recommendedTier}モデルで十分`
        : complexity > 70
          ? `複雑度${complexity}（高）のため${recommendedTier}モデルを推奨`
          : `複雑度${complexity}（中）に基づき${recommendedTier}モデルを推奨`;

  const availableProviders = discovery.providers.filter((p) => p.available).map((p) => p.provider);
  log.info(
    `[SmartRouter] Task ${taskId}: complexity=${complexity}, tier=${recommendedTier}, ` +
      `provider=${selected?.model.provider ?? 'fallback'}, model=${finalModel}, cost=$${costEstimate.estimatedCost}, ` +
      `available=[${availableProviders.join(',')}], discovered=${discovery.models.length}`,
  );

  return {
    recommendedModel: finalModel,
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

  // Resolve per-execution rates from the live discovery cache so retired and
  // newly-released models alike get a real number.
  const { models: discoveredForBudget } = await discoverModels();
  const rateById = new Map(discoveredForBudget.map((m) => [m.id, m.costPer1kTokens ?? 0]));
  let spent = 0;
  for (const exec of executions) {
    // Prefer the REAL recorded cost (parsed from the CLI's total_cost_usd).
    // The tokensUsed×rate estimate includes cache-read tokens at full rate,
    // which overstates spend by orders of magnitude on cache-heavy runs and
    // made budgetPressure fire spuriously. Estimate only for legacy rows
    // that predate cost recording.
    const recorded = coerceCostUsd((exec as { costUsd?: unknown }).costUsd);
    if (recorded > 0) {
      spent += recorded;
      continue;
    }
    const modelId = exec.agentConfig?.modelId || 'default';
    const rate =
      rateById.get(modelId) ??
      MODEL_COST_RATES[modelId] ??
      inferCostPer1k(modelId, classifyTier(modelId));
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
