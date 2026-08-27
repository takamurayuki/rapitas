/**
 * probe-cache
 *
 * Per-task, per-target TTL cache for probe results, so a phase transition
 * that already probed recently does not re-probe on every advance. Same
 * differentiated-TTL shape as model-discovery (short TTL for failures so a
 * transient-looking permanent verdict does not stick), but keyed per task
 * because the assigned agent can differ across tasks. Pure in-memory Map —
 * no Prisma schema change, consistent with the rest of this feature.
 */
import type { ProbeOutcome, ProbeTargetId } from './probe.types';

/** Successful probes stay cached for 1 minute — re-probe cost is low. */
export const PROBE_SUCCESS_TTL_MS = 60_000;
/** Permanent-failure verdicts expire after 15s so recovery is picked up fast. */
export const PROBE_FAILURE_TTL_MS = 15_000;

interface CacheEntry {
  outcome: ProbeOutcome;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(taskId: number, targetId: ProbeTargetId): string {
  return `${taskId}:${targetId}`;
}

/**
 * Reads a cached probe result for (taskId, targetId) if still fresh.
 *
 * @param taskId - Task being probed. / 対象タスクID
 * @param targetId - Probe target. / probe対象ID
 * @param nowMs - Reference clock (injected — never Date.now() here). / 現在時刻(ms)
 * @returns The cached outcome, or null on a miss/expiry. / キャッシュされた結果またはnull
 */
export function getCachedProbeResult(
  taskId: number,
  targetId: ProbeTargetId,
  nowMs: number,
): ProbeOutcome | null {
  const entry = cache.get(cacheKey(taskId, targetId));
  if (!entry || entry.expiresAt <= nowMs) return null;
  return entry.outcome;
}

/**
 * Stores a probe result for (taskId, targetId). TTL is chosen by outcome —
 * success caches longer than a permanent failure (see module doc).
 *
 * @param taskId - Task being probed. / 対象タスクID
 * @param targetId - Probe target. / probe対象ID
 * @param outcome - Result to cache (never `transient_retry` — only final
 *   success/permanent_failure results reach the cache). / キャッシュする結果
 * @param nowMs - Reference clock (injected). / 現在時刻(ms)
 */
export function setCachedProbeResult(
  taskId: number,
  targetId: ProbeTargetId,
  outcome: ProbeOutcome,
  nowMs: number,
): void {
  const ttl = outcome === 'success' ? PROBE_SUCCESS_TTL_MS : PROBE_FAILURE_TTL_MS;
  cache.set(cacheKey(taskId, targetId), { outcome, expiresAt: nowMs + ttl });
}

/**
 * Clears cached probe results. Exposed for admin/manual-retry entry points so
 * a fixed dependency does not stay masked behind a stale failure TTL.
 *
 * @param taskId - When given, clears only that task's entries; otherwise clears all. / 省略時は全消去
 */
export function invalidateProbeCache(taskId?: number): void {
  if (taskId === undefined) {
    cache.clear();
    return;
  }
  const prefix = `${taskId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
