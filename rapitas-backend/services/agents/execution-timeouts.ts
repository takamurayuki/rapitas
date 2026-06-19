/**
 * execution-timeouts
 *
 * Single source of truth for the agent/phase/lock timeouts so they stay
 * CONSISTENT. The invariant that matters:
 *
 *   agentTimeout  <  phaseTimeout  <  lockTtl
 *
 * - agentTimeout: the CLI agent self-terminates first (clean error), so a long
 *   but legitimate run ends on its own terms.
 * - phaseTimeout: the WorkflowRunner backstop, only for a genuinely hung phase.
 * - lockTtl: outlives a phase so a long phase never has its execution lock
 *   stolen (which would spawn a duplicate agent).
 *
 * Previously these were three independent hardcoded constants (runner 10min,
 * CLI 15min, lock 15min) where the runner's 10min fired FIRST and killed
 * legitimate long phases (e.g. a 42-file refactor) at exactly 10 minutes —
 * "Execution cancelled" mid-work, then an endless retry-and-die loop.
 *
 * Tune with `RAPITAS_PHASE_TIMEOUT_MS`; the other two derive from it.
 */

/** Default phase backstop (30 min) — generous so large refactors can finish. */
export const DEFAULT_PHASE_TIMEOUT_MS = 30 * 60 * 1000;
/** Lock outlives the phase by this margin. */
const LOCK_MARGIN_MS = 5 * 60 * 1000;
/** Agent self-terminates this much BEFORE the phase backstop. */
const AGENT_MARGIN_MS = 2 * 60 * 1000;
/** Floor so a misconfigured tiny value can't make agents un-runnable. */
const MIN_TIMEOUT_MS = 60 * 1000;

/**
 * Resolve the WorkflowRunner per-phase timeout (env-overridable).
 *
 * @returns Phase timeout in ms. / フェーズタイムアウト(ms)
 */
export function getPhaseTimeoutMs(): number {
  const raw = parseInt(process.env.RAPITAS_PHASE_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(raw) && raw >= MIN_TIMEOUT_MS ? raw : DEFAULT_PHASE_TIMEOUT_MS;
}

/**
 * Lock TTL — must exceed the phase timeout so a long phase keeps its lock.
 *
 * @returns Lock TTL in ms. / ロックTTL(ms)
 */
export function getWorkflowLockTtlMs(): number {
  return getPhaseTimeoutMs() + LOCK_MARGIN_MS;
}

/**
 * Agent CLI timeout — slightly under the phase backstop so the agent ends on
 * its own clean timeout before the runner force-aborts it.
 *
 * @returns Agent timeout in ms. / エージェントタイムアウト(ms)
 */
export function getAgentTimeoutMs(): number {
  return Math.max(MIN_TIMEOUT_MS, getPhaseTimeoutMs() - AGENT_MARGIN_MS);
}
