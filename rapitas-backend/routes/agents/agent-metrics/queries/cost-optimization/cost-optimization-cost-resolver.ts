/**
 * Cost Optimization Cost Resolver
 *
 * Resolves the USD cost of a single execution, shared by the aggregation
 * query and the suggestion-text generator so both agree on the same figure.
 */

import { toNumber } from '../../metric-coercion';

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
export function resolveExecutionCost(
  recordedCostUsd: unknown,
  tokensUsed: number,
  modelId: string,
): number {
  // toNumber (shared with usage-breakdown-query) survives the double-JSON
  // encoding some legacy costUsd rows carry from a past IPC bug.
  const recorded = toNumber(recordedCostUsd);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  const rate = FALLBACK_COST_PER_1K_TOKENS[modelId] ?? FALLBACK_COST_PER_1K_TOKENS['default'];
  return (tokensUsed / 1000) * rate;
}
