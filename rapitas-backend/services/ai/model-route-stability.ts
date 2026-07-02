/**
 * model-route-stability
 *
 * Pins SmartModelRouter's decision per task+role+minTier for the lifetime of
 * the process, so a same-phase RETRY (a workflow queue re-run, a discovery
 * cache rollover, or a provider briefly flapping in/out of cooldown) does not
 * silently switch the model mid-phase — the same prompt should see the same
 * model. `minTier` is folded into the cache key (not just `taskId:role`) so a
 * genuinely DELIBERATE escalation (retry/theme-outcome escalation or a
 * risk-based floor raise in workflow-orchestrator's routing-policy) still
 * re-routes: it computes a different minTier, which is a different key.
 *
 * Deliberate provider-failure fallback (workflow-orchestrator's
 * tryProviderFallback) intentionally calls smart-model-router's getSmartRoute
 * directly, bypassing this cache, and then calls invalidateStableRoute() so
 * the NEXT ordinary retry re-routes fresh instead of reusing the pinned model
 * that just failed.
 *
 * No existing Prisma column fits "resolved model for this task+role":
 * AgentExecutionConfig is one row per TASK (not per role) and its fields are
 * all user-facing execution settings; AgentSession.mode stores the role label
 * but AgentSession rows are per execution attempt, not a stable per-phase
 * slot. Adding a column is out of scope (schema changes are prohibited here),
 * so this is process-memory only — the pin resets on backend restart, which
 * is an acceptable discontinuity (a restart already breaks other in-memory
 * state such as provider-cooldown and outcome-reinforcement traces).
 */
import { getSmartRoute, type SmartRouteOptions, type RoutingDecision } from './smart-model-router';

const routeCache = new Map<string, RoutingDecision>();

function cacheKey(taskId: number, role: string, minTier?: string | null): string {
  return `${taskId}:${role}:${minTier ?? 'none'}`;
}

/**
 * Same as {@link getSmartRoute}, but returns a pinned decision for repeat
 * calls with the same taskId+role+minTier within this process.
 *
 * @param taskId - Task ID being routed. / タスクID
 * @param role - Workflow role driving this route; part of the cache key. / ロール
 * @param options - Passed through to getSmartRoute on a cache miss. / ルーティングオプション
 * @returns The pinned (or freshly computed) routing decision. / ルーティング決定
 */
export async function getStableSmartRoute(
  taskId: number,
  role: string,
  options: SmartRouteOptions = {},
): Promise<RoutingDecision> {
  const key = cacheKey(taskId, role, options.minTier);
  const cached = routeCache.get(key);
  if (cached) return cached;

  const route = await getSmartRoute(taskId, options);
  routeCache.set(key, route);
  return route;
}

/**
 * Drop every pinned route for a task+role (all minTier variants). Call this
 * after a DELIBERATE re-route (e.g. provider-failure fallback) so the next
 * ordinary retry recomputes fresh instead of reusing a pin that is now known
 * to be stale (e.g. it points at a model whose provider just entered
 * cooldown).
 *
 * @param taskId - Task ID whose pins should be cleared. / タスクID
 * @param role - Workflow role whose pins should be cleared. / ロール
 */
export function invalidateStableRoute(taskId: number, role: string): void {
  const prefix = `${taskId}:${role}:`;
  for (const key of routeCache.keys()) {
    if (key.startsWith(prefix)) routeCache.delete(key);
  }
}

/** Test-only: clear the entire pin cache. */
export function _resetStableRouteCache(): void {
  routeCache.clear();
}
