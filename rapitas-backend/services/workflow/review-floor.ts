/**
 * review-floor
 *
 * The one-way link between the implementer and every role that judges its
 * work: a review role's tier floor is at least the executor's tier (追補5:
 * レビュー役 ≧ 実行役). Applied to the ordinary verifier / auto_verifier route —
 * and so to a mid-task provider switch, which re-uses that route — the same
 * way the jury seats apply it. Not responsible for the other floors
 * (routing-policy.ts) or for choosing the model.
 */
import type { ModelTier } from '../ai/model-discovery/types';
import type { ExecutorRef } from '../ai/model-tier-table/seat-planner';
import { strongerTier, tierAtLeast } from '../ai/model-tier-table/tier-table';

/** Workflow roles that judge the implementer's work. */
export const REVIEW_ROLES: ReadonlySet<string> = new Set(['verifier', 'auto_verifier']);

/** A review role's floor after the executor link. */
export interface ReviewFloor {
  tier: ModelTier | undefined;
  reason?: string;
  executor: ExecutorRef;
}

/**
 * Raise a review role's floor to the executor's tier.
 *
 * An unverified executor (no implementer run reported a model) counts as
 * premium, so the floor is decided by the strongest possible executor. A
 * local (free) executor raises nothing.
 *
 * @param taskId - Task being routed / タスクID
 * @param floor - Floor from the routing policy / ルーティング方針の下限
 * @returns The raised floor, its reason, and the executor used / 引き上げ後の下限
 */
export async function raiseFloorToExecutor(
  taskId: number,
  floor: { tier: ModelTier | undefined; reason?: string },
): Promise<ReviewFloor> {
  // Lazy: the executor lookup reads the database, and this module is imported
  // by role routing, which many tests load with a partial database mock.
  const { resolveExecutor } = await import('../ai/model-tier-table/executor-model');
  const executor = await resolveExecutor(taskId);
  if (executor.tier === 'free') return { ...floor, executor };
  const executorTier = executor.tier as ModelTier;
  if (floor.tier && tierAtLeast(floor.tier, executorTier)) return { ...floor, executor };
  const tier = floor.tier ? strongerTier<ModelTier>(floor.tier, executorTier) : executorTier;
  const who = executor.verified
    ? `実行役 ${executor.modelId}（${executor.tier}）`
    : '実行役が実行記録から確認できない（premium とみなす）';
  return {
    tier,
    reason: floor.reason ? `${floor.reason} / ${who}以上` : `${who}以上`,
    executor,
  };
}
