/**
 * budget-status
 *
 * Weekly spend status for the SmartModelRouter's budget pressure and the
 * cost-explorer UI. Moved out of smart-model-router.ts unchanged (file-size
 * limit). Not responsible for choosing a model.
 */
import { prisma } from '../../config/database';
import { discoverModels } from './model-discovery';
import { classifyTier, inferCostPer1k } from './model-discovery/tier-classifier';
import { sumAttributedSpend } from '../agents/execution-cost-attribution';
import type { BudgetStatus } from './smart-model-router';

/**
 * Per-1K-token cost fallback for a model discovery no longer lists. Empty by
 * design — kept for parity with the router, which has the same table.
 */
const MODEL_COST_RATES: Record<string, number> = {};

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
      // NOTE: Jury cost rows are deliberately included — review spend is real
      // subscription consumption and belongs in the weekly budget.
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
  // Each row's OWN increment, not the recorded value: costUsd holds the CLI's
  // session-cumulative total_cost_usd, so summing the rows of a resumed session
  // counts its running total again every cycle. Measured 2026-10-13: $523.84
  // for the week against a real $357.66 over 450 executions. Estimating from
  // tokens is the fallback only for legacy rows with no recorded cost — that
  // estimate charges cache reads at full rate and overstates a cache-heavy run
  // by orders of magnitude.
  let spent = sumAttributedSpend(executions, (exec) => {
    const modelId = exec.agentConfig?.modelId || 'default';
    const rate =
      rateById.get(modelId) ??
      MODEL_COST_RATES[modelId] ??
      inferCostPer1k(modelId, classifyTier(modelId));
    return (exec.tokensUsed / 1000) * rate;
  });
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
