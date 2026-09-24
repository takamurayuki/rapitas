/**
 * outage-classifier
 *
 * Pure three-level stop verdict (safe / risk / danger) from the estimated
 * recovery time R, the tolerance T (lowest SLA across the target and every
 * impacted service — the impact floor) and the blast ratio B. Also owns the
 * p90 recovery estimator. Does no IO and no timing.
 */
import { computeImpact } from './dependency-graph';
import {
  DANGER_BLAST_RATIO,
  MIN_HISTORY_SAMPLES,
  RECOVERY_PERCENTILE,
  SAFE_BLAST_RATIO,
  SAFE_RECOVERY_RATIO,
  type OutageAssessment,
  type OutageInventory,
  type OutageReason,
  type OutageVerdict,
} from './outage-guidance.types';

/** Inputs of the verdict rule. */
export interface ClassifyInput {
  recoveryMinutes: number;
  toleranceMinutes: number;
  blastRatio: number;
  historySamples: number;
  /**
   * When true (default) fewer than MIN_HISTORY_SAMPLES samples block `safe`.
   * Ground-truth labelling passes false because it uses measured values.
   */
  requireHistory?: boolean;
}

/**
 * Nearest-rank percentile (the ceil(p·n)-th smallest value).
 *
 * @param values - Samples / 標本
 * @param p - Percentile in (0,1] / パーセンタイル
 * @returns The percentile value / パーセンタイル値
 * @throws {Error} When `values` is empty / 標本が空の場合
 */
export function percentileNearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('percentileNearestRank: empty input');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1];
}

/**
 * Estimates recovery minutes: p90 of history when there are enough samples,
 * otherwise the larger of the declared estimate and the worst observed value.
 *
 * @param declaredMinutes - Owner-declared recovery / オーナー申告の復旧見込み
 * @param history - Past recovery minutes of this service / 過去の復旧時間
 * @returns Estimate and sample count / 推定値と標本数
 */
export function estimateRecovery(
  declaredMinutes: number,
  history: readonly number[],
): { minutes: number; samples: number } {
  if (history.length >= MIN_HISTORY_SAMPLES) {
    return {
      minutes: percentileNearestRank(history, RECOVERY_PERCENTILE),
      samples: history.length,
    };
  }
  return { minutes: Math.max(declaredMinutes, ...history), samples: history.length };
}

/**
 * Impacted count normalized by the other services, so teams of different size compare.
 *
 * @param impactedCount - Number of impacted services / 影響サービス数
 * @param totalServices - Services in the inventory / 全サービス数
 * @returns Ratio in [0,1] (0 for a single-service inventory) / 波及率
 */
export function computeBlastRatio(impactedCount: number, totalServices: number): number {
  return totalServices <= 1 ? 0 : impactedCount / (totalServices - 1);
}

/**
 * Applies the verdict rule in order: danger → safe → risk.
 *
 * @param input - R, T, B and history size / 判定入力
 * @returns Verdict and the reasons behind it / 判定と根拠
 */
export function classifyOutage(input: ClassifyInput): {
  verdict: OutageVerdict;
  reasons: OutageReason[];
} {
  const { recoveryMinutes: r, toleranceMinutes: t, blastRatio: b, historySamples } = input;
  const requireHistory = input.requireHistory ?? true;

  const dangerReasons: OutageReason[] = [];
  // Strict > — recovering in exactly T minutes still meets the SLA.
  if (r > t) dangerReasons.push('recovery_exceeds_tolerance');
  if (b >= DANGER_BLAST_RATIO) dangerReasons.push('wide_blast_radius');
  if (dangerReasons.length > 0) return { verdict: 'danger', reasons: dangerReasons };

  const enoughHistory = !requireHistory || historySamples >= MIN_HISTORY_SAMPLES;
  const withinMargin = r <= SAFE_RECOVERY_RATIO * t;
  const narrowBlast = b < SAFE_BLAST_RATIO;
  if (enoughHistory && withinMargin && narrowBlast) {
    return { verdict: 'safe', reasons: ['within_safety_margin'] };
  }

  const reasons: OutageReason[] = [];
  if (!enoughHistory) reasons.push('insufficient_history');
  if (!withinMargin) reasons.push('narrow_margin');
  if (!narrowBlast) reasons.push('wide_blast_radius');
  return { verdict: 'risk', reasons };
}

/**
 * Lowest SLA among the given services — the level recovery must reach so
 * that every impacted service stays within its SLA.
 *
 * @param inventory - Validated inventory / 検証済みインベントリ
 * @param serviceIds - Target plus impacted ids / 対象と影響サービスのID
 * @returns Tolerance in minutes / 許容時間（分）
 */
export function toleranceFor(inventory: OutageInventory, serviceIds: readonly string[]): number {
  const wanted = new Set(serviceIds);
  let min = Number.POSITIVE_INFINITY;
  for (const s of inventory.services) {
    if (wanted.has(s.id) && s.slaMinutes < min) min = s.slaMinutes;
  }
  return min;
}

/**
 * Full assessment of stopping one service given its recovery history.
 * `computedInMs` is left at 0 — timing belongs to the caller.
 *
 * @param inventory - Validated inventory / 検証済みインベントリ
 * @param targetId - Service to stop (must exist) / 停止対象（存在すること）
 * @param history - Recovery minutes of past incidents of the target / 対象の過去の復旧時間
 * @returns Assessment with evidence paths / 根拠パス付きの判定結果
 */
export function evaluateOutage(
  inventory: OutageInventory,
  targetId: string,
  history: readonly number[],
): OutageAssessment {
  const target = inventory.services.find((s) => s.id === targetId);
  if (!target) throw new Error(`evaluateOutage: unknown service ${targetId}`);
  const affected = computeImpact(inventory, targetId);
  const toleranceMinutes = toleranceFor(inventory, [targetId, ...affected.map((a) => a.serviceId)]);
  const recovery = estimateRecovery(target.declaredRecoveryMinutes, history);
  const blastRatio = computeBlastRatio(affected.length, inventory.services.length);
  const { verdict, reasons } = classifyOutage({
    recoveryMinutes: recovery.minutes,
    toleranceMinutes,
    blastRatio,
    historySamples: recovery.samples,
  });
  return {
    targetServiceId: targetId,
    verdict,
    estimatedRecoveryMinutes: recovery.minutes,
    toleranceMinutes,
    historySamples: recovery.samples,
    blastRatio,
    affected,
    reasons,
    computedInMs: 0,
  };
}
