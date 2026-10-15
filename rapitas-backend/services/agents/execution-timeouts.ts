/**
 * execution-timeouts
 *
 * Single source of truth for the agent/phase/lock/IPC timeouts so they stay
 * CONSISTENT. The invariant that matters:
 *
 *   agentTimeout  <  phaseTimeout  <  lockTtl  <=  ipcRequestTimeout
 *
 * - agentTimeout: the CLI agent self-terminates first (clean error), so a long
 *   but legitimate run ends on its own terms.
 * - phaseTimeout: the WorkflowRunner backstop, only for a genuinely hung phase.
 * - lockTtl: outlives a phase so a long phase never has its execution lock
 *   stolen (which would spawn a duplicate agent).
 * - ipcRequestTimeout: the OUTERMOST timer. It is only a transport backstop for
 *   a worker that stopped answering at all — never the thing that ends a run.
 *
 * Previously these were three independent hardcoded constants (runner 10min,
 * CLI 15min, lock 15min) where the runner's 10min fired FIRST and killed
 * legitimate long phases (e.g. a 42-file refactor) at exactly 10 minutes —
 * "Execution cancelled" mid-work, then an endless retry-and-die loop.
 *
 * The IPC layer repeated that mistake with its own hardcoded 20 min, BELOW the
 * 28 min (56 min for implementer) agent cap: task 585's researcher was killed
 * with "IPC request timeout: execute-task" at exactly 20:00 while its CLI kept
 * running for another 8 minutes as an orphan. Every timer now derives from
 * here, so a new layer cannot silently undercut the others again.
 *
 * Tune with `RAPITAS_PHASE_TIMEOUT_MS`; the other two derive from it.
 * Per-role wall-clock overrides: `RAPITAS_AGENT_WALLCLOCK_MS` (all roles) and
 * `RAPITAS_AGENT_WALLCLOCK_<ROLE>_MS` (single role, uppercased WorkflowRole).
 */
import type { WorkflowRole } from '../workflow/workflow-types';

/** Default phase backstop (30 min) — generous so large refactors can finish. */
export const DEFAULT_PHASE_TIMEOUT_MS = 30 * 60 * 1000;
/** Lock outlives the phase by this margin. */
const LOCK_MARGIN_MS = 5 * 60 * 1000;
/** Agent self-terminates this much BEFORE the phase backstop. */
const AGENT_MARGIN_MS = 2 * 60 * 1000;
/** IPC transport backstop sits this much ABOVE the lock TTL (outermost timer). */
const IPC_MARGIN_MS = 5 * 60 * 1000;
/** Floor so a misconfigured tiny value can't make agents un-runnable. */
const MIN_TIMEOUT_MS = 60 * 1000;
// NOTE: task 546 — implementer runs get 2x the base wall-clock cap. Task 545
// (execution 2090) was force-killed at the shared 28-min cap mid-implementation
// and succeeded on retry in ~25 min; other roles keep the current value.
const IMPLEMENTER_MULTIPLIER = 2;

/**
 * Parse an env var as a timeout in ms.
 *
 * @param key - Env var name to read. / 読み取る環境変数名
 * @param env - Env source (injectable for tests). / 環境変数ソース
 * @returns The value in ms when finite and >= the 60s floor, else null. / 有効値(ms)または null
 */
function readEnvMs(key: string, env: NodeJS.ProcessEnv): number | null {
  const raw = parseInt(env[key] ?? '', 10);
  return Number.isFinite(raw) && raw >= MIN_TIMEOUT_MS ? raw : null;
}

/**
 * Resolve the WorkflowRunner per-phase timeout (env-overridable).
 *
 * @param role - Upcoming phase role; implementer raises the backstop so it stays above the agent cap. / 次フェーズのロール
 * @returns Phase timeout in ms. / フェーズタイムアウト(ms)
 */
export function getPhaseTimeoutMs(role?: WorkflowRole): number {
  const base = readEnvMs('RAPITAS_PHASE_TIMEOUT_MS', process.env) ?? DEFAULT_PHASE_TIMEOUT_MS;
  if (role !== 'implementer') return base;
  // Keep the invariant agent < phase for the implementer's raised wall-clock cap.
  return Math.max(base, getAgentTimeoutMs('implementer') + AGENT_MARGIN_MS);
}

/**
 * Resolve the per-role agent wall-clock cap.
 *
 * Priority: RAPITAS_AGENT_WALLCLOCK_<ROLE>_MS > RAPITAS_AGENT_WALLCLOCK_MS >
 * role default (implementer = base x2, others = base).
 *
 * @param role - Workflow role the agent runs as. / エージェントのロール
 * @param env - Env source (injectable for tests). / 環境変数ソース
 * @returns Wall-clock cap in ms. / ウォールクロック上限(ms)
 */
export function resolveAgentWallClockTimeoutMs(
  role?: WorkflowRole,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (role) {
    const perRole = readEnvMs(`RAPITAS_AGENT_WALLCLOCK_${role.toUpperCase()}_MS`, env);
    if (perRole !== null) return perRole;
  }
  const shared = readEnvMs('RAPITAS_AGENT_WALLCLOCK_MS', env);
  if (shared !== null) return shared;
  // Role-less getPhaseTimeoutMs() on purpose — passing the role here would
  // recurse (getPhaseTimeoutMs(implementer) derives from this function).
  const base = Math.max(MIN_TIMEOUT_MS, getPhaseTimeoutMs() - AGENT_MARGIN_MS);
  return role === 'implementer' ? base * IMPLEMENTER_MULTIPLIER : base;
}

/**
 * Lock TTL — must exceed the phase timeout so a long phase keeps its lock.
 *
 * NOTE: derived from the LONGEST phase (implementer, 2x wall-clock), not the
 * role-less base. The role-less value (35 min) sat BELOW the implementer's own
 * phase timeout (58 min), so a legitimate long implementation could have its
 * lock expire mid-run and let a second agent start on the same task — the
 * exact failure the TTL exists to prevent. Over-long TTL is harmless: every
 * normal exit path releases the lock explicitly; this is only the backstop.
 *
 * @returns Lock TTL in ms. / ロックTTL(ms)
 */
export function getWorkflowLockTtlMs(): number {
  return getPhaseTimeoutMs('implementer') + LOCK_MARGIN_MS;
}

/**
 * IPC request timeout for worker calls that carry a WHOLE phase execution
 * (execute-task / continue / resume). Must be the outermost timer: the agent,
 * phase and lock backstops all fire first, so a timeout here means the worker
 * itself stopped answering — not that the work took too long.
 *
 * @returns IPC request timeout in ms. / IPCリクエストタイムアウト(ms)
 */
export function getIpcExecutionTimeoutMs(): number {
  return getWorkflowLockTtlMs() + IPC_MARGIN_MS;
}

/**
 * Agent CLI timeout — slightly under the phase backstop so the agent ends on
 * its own clean timeout before the runner force-aborts it.
 *
 * @param role - Workflow role; implementer gets a raised cap. / ロール(implementerは上限2倍)
 * @returns Agent timeout in ms. / エージェントタイムアウト(ms)
 */
export function getAgentTimeoutMs(role?: WorkflowRole): number {
  return Math.max(MIN_TIMEOUT_MS, resolveAgentWallClockTimeoutMs(role));
}
