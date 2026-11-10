/**
 * workflow-provider-reroute
 *
 * Picks the replacement model when a phase's provider fails mid-task (quota,
 * rate limit, auth): the same role routing a normal run uses, with the failed
 * provider excluded, so the role's floors and caps survive the switch
 * (追補5, 修正リストD). Not responsible for running the phase or marking the
 * cooldown (workflow-provider-fallback.ts).
 */
import type { Provider } from '../ai/model-discovery/types';
import type { WorkflowRole } from './workflow-types';

/**
 * Re-route one phase away from a failed provider under the role's constraints.
 *
 * Falls back to the bare SmartRouter call (failed provider excluded, no
 * floors) only when the task cannot be read or role routing reports its own
 * failure; `constraintsKept` says which happened, for the audit record.
 *
 * @param taskId - Task being executed / タスクID
 * @param role - Phase role / ロール
 * @param failedProvider - Provider that just failed / 失敗したプロバイダ
 * @returns Model, routing details, and whether the constraints held / 再割り当て結果
 */
export async function rerouteWithConstraints(
  taskId: number,
  role: WorkflowRole,
  failedProvider: Provider,
): Promise<{ modelId: string; details: Record<string, unknown>; constraintsKept: boolean }> {
  const { prisma } = await import('../../config/database');
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { title: true, description: true, labels: true, themeId: true },
    })
    .catch(() => null);
  if (task) {
    const { routeModelForRole } = await import('./role-route-inputs');
    const routed = await routeModelForRole({
      taskId,
      role,
      task,
      excludeProviders: [failedProvider],
    });
    // routeModelForRole never throws; `fallback` marks its own failure path.
    if (!routed.details.fallback) {
      return { modelId: routed.modelId, details: routed.details, constraintsKept: true };
    }
  }
  const { getSmartRoute } = await import('../ai/smart-model-router');
  const route = await getSmartRoute(taskId, { excludeProviders: [failedProvider], role });
  return { modelId: route.recommendedModel, details: {}, constraintsKept: false };
}
