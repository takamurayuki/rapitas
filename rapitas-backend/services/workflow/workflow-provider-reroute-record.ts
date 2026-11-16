/**
 * workflow-provider-reroute-record
 *
 * Writes the decision-trace record of a failure-driven re-route: what was
 * switched to (or that the switch was refused), whether the role's
 * constraints were applied, and whether the chosen model meets them. Not
 * responsible for choosing the model (workflow-provider-reroute.ts).
 */
import type { RerouteResult } from './workflow-provider-reroute';

/**
 * Record one re-route decision. Fire-and-forget: the record must never hold
 * up or fail the switch.
 *
 * @param taskId - Task being executed / タスクID
 * @param r.role - Phase role / ロール
 * @param r.failedProvider - Provider that failed / 失敗したプロバイダ
 * @param r.failureReason - Why it failed (quota / auth …) / 失敗理由
 * @param r.previousModel - Model that was running / 切替前のモデル
 * @param r.rerouted - The re-route outcome / 再割り当て結果
 */
export function recordRerouteDecision(
  taskId: number,
  r: {
    role: string;
    failedProvider: string;
    failureReason: string;
    previousModel: string | null | undefined;
    rerouted: RerouteResult;
  },
): void {
  const { rerouted } = r;
  const cause = `プロバイダ ${r.failedProvider} が ${r.failureReason} で cooldown に入ったための再ルーティング`;
  const adoptedId = rerouted.ok ? rerouted.modelId : 'reroute_refused';
  const adoptedReason = !rerouted.ok
    ? `${cause}を見送り（${rerouted.detail}）`
    : rerouted.constraintsMet
      ? `${cause}（ロールの制約を満たす）`
      : `${cause}（ロールの制約を渡したが未達: ${rerouted.shortfall?.reason ?? '不明'}）`;
  void import('../observability/decision-trace')
    .then(({ recordDecision }) =>
      recordDecision({
        taskId,
        nodeKey: `task${taskId}:provider-fallback:${Date.now()}`,
        kind: 'api_call',
        summary: rerouted.ok
          ? `プロバイダフォールバック: ${rerouted.modelId}`
          : 'プロバイダフォールバック: 見送り',
        input: {
          role: r.role,
          failedProvider: r.failedProvider,
          failureReason: r.failureReason,
          previousModel: r.previousModel ?? null,
          constraintsApplied: rerouted.ok,
          constraintsMet: rerouted.ok ? rerouted.constraintsMet : false,
          refusedReason: rerouted.ok ? null : rerouted.reason,
          shortfall: rerouted.shortfall ?? null,
          minTier: rerouted.ok ? (rerouted.details.minTier ?? null) : null,
          minTierReason: rerouted.ok ? (rerouted.details.minTierReason ?? null) : null,
          budgetCapTier: rerouted.ok ? (rerouted.details.budgetCapTier ?? null) : null,
        },
        candidates: rerouted.ok ? [{ id: rerouted.modelId, label: 'フォールバック候補' }] : [],
        adoptedId,
        adoptedReason,
      }),
    )
    .catch(() => {});
}
