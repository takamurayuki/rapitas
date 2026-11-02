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
 * The pin is also written to the timeline, so it survives a restart.
 *
 * It used to be process memory alone, on the argument that a restart is an
 * acceptable discontinuity. Measured 2026-10-21, it is not: this backend
 * restarts on every deploy and at every auto-run quiet point, and over
 * fourteen days 523 executions ran across three tiers (sonnet 460, opus 49,
 * haiku 6). A task whose workflow spans a restart could therefore change
 * model between its own phases — the one thing this module exists to stop.
 *
 * No Prisma column fits "resolved model for this task+role":
 * AgentExecutionConfig is one row per TASK, and AgentSession rows are per
 * execution attempt rather than a stable per-phase slot. A timeline event
 * needs no schema change (and so no restart to deploy), and is readable
 * through the same API as the other harness records.
 *
 * Fails open throughout. A pin that cannot be read or written must never
 * stop a phase from routing — the fallback is a fresh decision, which is
 * the behaviour this module replaced.
 */
import { createLogger } from '../../config/logger';
import { appendEvent, queryEvents, deleteEvents } from '../memory/timeline';
import { getSmartRoute, type SmartRouteOptions, type RoutingDecision } from './smart-model-router';

const log = createLogger('ai:model-route-stability');

const routeCache = new Map<string, RoutingDecision>();

/** Timeline event type holding one pinned route. */
const EVENT_TYPE = 'model_route_pin';

/**
 * How long a pin stays usable.
 *
 * Matches the context snapshot: a task still running a day later has been
 * through something, and re-routing it against current evidence is the
 * better default.
 */
export const PIN_TTL_MS = 24 * 60 * 60 * 1000;

/** Longest a pin lookup may delay routing before it gives up and recomputes. */
const READ_TIMEOUT_MS = 1_500;

/**
 * Correlation id for one task+role.
 *
 * Per role, not per task: invalidation after a provider failure must drop
 * that role's pins and leave the task's other phases pinned.
 */
const correlation = (taskId: number, role: string) => `route_${taskId}_${role}`;

/** Read back a pinned decision for exactly this key, if one is stored. */
async function readPin(
  taskId: number,
  role: string,
  minTier: string | null | undefined,
  capTier: string | null | undefined,
): Promise<RoutingDecision | null> {
  try {
    const { events } = await Promise.race([
      queryEvents({
        eventType: EVENT_TYPE,
        correlationId: correlation(taskId, role),
        limit: 20,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('pin read timed out')), READ_TIMEOUT_MS),
      ),
    ]);
    for (const event of events) {
      const payload = (
        typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
      ) as {
        minTier?: string | null;
        capTier?: string | null;
        decision?: RoutingDecision;
      };
      // The tiers are part of the identity: a deliberate escalation computes
      // a different minTier, and must re-route rather than reuse this.
      if ((payload?.minTier ?? null) !== (minTier ?? null)) continue;
      if ((payload?.capTier ?? null) !== (capTier ?? null)) continue;
      // Any stored object, not a specific field: what was pinned is
      // whatever getSmartRoute returned, and this module has no business
      // asserting that shape — it only has to give the same one back.
      if (!payload?.decision || typeof payload.decision !== 'object') continue;
      if (Date.now() - new Date(event.createdAt).getTime() > PIN_TTL_MS) continue;
      return payload.decision;
    }
  } catch (err) {
    log.debug({ err, taskId, role }, 'pin read failed — routing fresh');
  }
  return null;
}

// NOTE: capTier joins minTier in the key so an evidence change (a role newly
// proving a cheaper tier, or losing that proof) re-routes deliberately instead
// of being masked by a stale pin.
function cacheKey(
  taskId: number,
  role: string,
  minTier?: string | null,
  capTier?: string | null,
): string {
  return `${taskId}:${role}:${minTier ?? 'none'}:${capTier ?? 'none'}`;
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
  const key = cacheKey(taskId, role, options.minTier, options.capTier);
  const cached = routeCache.get(key);
  if (cached) return cached;

  // Only a cold process pays this read, which is exactly the case the
  // persisted pin exists for: the restart that used to lose it.
  const stored = await readPin(taskId, role, options.minTier, options.capTier);
  if (stored) {
    routeCache.set(key, stored);
    return stored;
  }

  // The role is known here and nowhere below, so pass it down for the audit
  // trail rather than making every caller remember to repeat it.
  const route = await getSmartRoute(taskId, { role, ...options });
  routeCache.set(key, route);
  // Not awaited: this process already holds the pin in memory, and the
  // persisted copy only matters after a restart. Blocking a route on a
  // database write would put the store on the hot path of every phase —
  // and a store that hangs would hang routing with it.
  void appendEvent({
    eventType: EVENT_TYPE,
    actorType: 'system',
    payload: {
      taskId,
      role,
      minTier: options.minTier ?? null,
      capTier: options.capTier ?? null,
      decision: route,
    },
    correlationId: correlation(taskId, role),
  }).catch((err) => log.debug({ err, taskId, role }, 'pin write failed — memory still holds it'));
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
export async function invalidateStableRoute(taskId: number, role: string): Promise<void> {
  const prefix = `${taskId}:${role}:`;
  for (const key of routeCache.keys()) {
    if (key.startsWith(prefix)) routeCache.delete(key);
  }
  try {
    // Narrow by construction: the correlation id names one task AND one
    // role, so the task's other phases keep their pins.
    await deleteEvents({ eventType: EVENT_TYPE, correlationId: correlation(taskId, role) });
  } catch (err) {
    log.debug({ err, taskId, role }, 'pin delete failed — a stale pin may outlive this process');
  }
}

/** Test-only: clear the in-process pin cache (not the persisted pins). */
export function _resetStableRouteCache(): void {
  routeCache.clear();
}
