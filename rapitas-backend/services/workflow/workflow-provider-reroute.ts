/**
 * workflow-provider-reroute
 *
 * Picks the replacement model when a phase's provider fails mid-task (quota,
 * rate limit, auth): the same role routing a normal run uses, with the failed
 * provider excluded, so the role's floors and caps survive the switch
 * (追補5, 修正リストD). Not responsible for running the phase or marking the
 * cooldown (workflow-provider-fallback.ts).
 *
 * Two things are reported separately: whether the constraints were PASSED to
 * the router (`constraintsApplied`), and whether the model it returned MEETS
 * them (`constraintsMet`). SmartRouter returns normally even below its floor,
 * so "passed" alone never meant "kept".
 */
import type { Provider } from '../ai/model-discovery/types';
import type { RouteShortfall } from '../ai/route-shortfall';
import type { WorkflowRole } from './workflow-types';

/** A replacement the switch may run. */
export interface RerouteChoice {
  ok: true;
  modelId: string;
  details: Record<string, unknown>;
  /** The role's floors / caps / exclusions were given to the router. */
  constraintsApplied: true;
  /** The returned model meets them (no shortfall). */
  constraintsMet: boolean;
  shortfall?: RouteShortfall;
}

/** No replacement may run: the switch must not happen. */
export interface RerouteRefusal {
  ok: false;
  reason: 'task_unreadable' | 'role_routing_failed' | 'no_candidates' | 'excluded_provider';
  detail: string;
  shortfall?: RouteShortfall;
}

/** Outcome of a constrained re-route. */
export type RerouteResult = RerouteChoice | RerouteRefusal;

/**
 * Shortfalls under which the switch is refused outright: the model would be a
 * bare alias nothing offered, or the very provider that just failed.
 * A tier / role shortfall still runs, recorded — the same policy as a normal
 * route — and a review role's verdict on it is not accepted as verification
 * (verifier-eligibility.ts).
 */
const REFUSED_SHORTFALLS = new Set<RouteShortfall['kind']>(['no_candidates', 'excluded_provider']);

/**
 * Re-route one phase away from a failed provider under the role's constraints.
 *
 * Never falls back to an unconstrained router call: when the task cannot be
 * read or role routing fails, the result is a refusal and the caller keeps
 * the original failure rather than running without floors or the budget cap.
 *
 * @param taskId - Task being executed / タスクID
 * @param role - Phase role / ロール
 * @param failedProvider - Provider that just failed / 失敗したプロバイダ
 * @returns The replacement and whether it meets the constraints, or a refusal / 再割り当て結果
 */
export async function rerouteWithConstraints(
  taskId: number,
  role: WorkflowRole,
  failedProvider: Provider,
): Promise<RerouteResult> {
  const { prisma } = await import('../../config/database');
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { title: true, description: true, labels: true, themeId: true },
    })
    .catch(() => null);
  if (!task) {
    return {
      ok: false,
      reason: 'task_unreadable',
      detail: 'タスクを読めないため、ロールの制約で再ルーティングできない',
    };
  }
  const { routeModelForRole } = await import('./role-route-inputs');
  const routed = await routeModelForRole({
    taskId,
    role,
    task,
    excludeProviders: [failedProvider],
  });
  if (routed.routingFailed || routed.details.fallback) {
    return {
      ok: false,
      reason: 'role_routing_failed',
      detail: 'ロールの経路が失敗したため、下限・予算上限のない選択で続行しない',
    };
  }
  const shortfall = routed.constraintShortfall;
  if (shortfall && REFUSED_SHORTFALLS.has(shortfall.kind)) {
    return {
      ok: false,
      reason: shortfall.kind as RerouteRefusal['reason'],
      detail: shortfall.reason,
      shortfall,
    };
  }
  return {
    ok: true,
    modelId: routed.modelId,
    details: routed.details,
    constraintsApplied: true,
    constraintsMet: !shortfall,
    ...(shortfall ? { shortfall } : {}),
  };
}
