/**
 * runtime-server-shutdown
 *
 * Stops every runtime-smoke preview server this backend still owns before the
 * process exits. A preview that outlives the backend inherits its listening
 * socket handle (Windows), so port 3001 stays LISTENING under a dead pid and
 * the supervisor cannot respawn — 2026-09-13 19:35–19:54, task 910's preview
 * (spawned 50 s before a self-restart, idle-stop still pending) blocked the
 * restart for 19 minutes. Not responsible for deciding when to shut down.
 */
import { createLogger } from '../../../../config/logger';
import { cancelIdleTimer, registry } from './runtime-server-registry-types';
import { stopOwnedAndVerify } from './runtime-server-registry-lifecycle';

const log = createLogger('runtime-smoke:shutdown');

/** Must fit inside the 30 s shutdown watchdog with room for agent shutdown. */
export const RUNTIME_SERVER_SHUTDOWN_TIMEOUT_MS = 15_000;

/** Outcome of the pre-exit sweep. */
export interface RuntimeServerShutdownResult {
  attempted: number;
  stopped: number;
  timedOut: boolean;
}

/**
 * Stop all non-quarantined registry entries, bounded by `timeoutMs` so a hung
 * stop cannot delay the exit past the shutdown watchdog.
 *
 * @param reason - Cause recorded on each stop / 停止理由
 * @param timeoutMs - Upper bound for the whole sweep / 全体の上限時間
 * @returns Counts of attempted and verified stops / 停止試行数と確認数
 */
export async function stopAllRuntimeServersForShutdown(
  reason = 'backend shutdown',
  timeoutMs = RUNTIME_SERVER_SHUTDOWN_TIMEOUT_MS,
): Promise<RuntimeServerShutdownResult> {
  const entries = [...registry.values()].filter((entry) => entry.state !== 'quarantined');
  if (entries.length === 0) return { attempted: 0, stopped: 0, timedOut: false };
  log.info({ count: entries.length, reason }, '[shutdown] stopping owned runtime servers');
  for (const entry of entries) cancelIdleTimer(entry);
  const sweep = Promise.allSettled(entries.map((entry) => stopOwnedAndVerify(entry, reason)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const outcome = await Promise.race([sweep, timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === 'timeout') {
    log.warn({ count: entries.length, timeoutMs }, '[shutdown] runtime server stop timed out');
    return { attempted: entries.length, stopped: 0, timedOut: true };
  }
  const stopped = outcome.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  log.info({ attempted: entries.length, stopped }, '[shutdown] runtime servers stopped');
  return { attempted: entries.length, stopped, timedOut: false };
}
