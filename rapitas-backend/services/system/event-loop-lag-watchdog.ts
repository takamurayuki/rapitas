/**
 * event-loop-lag-watchdog
 *
 * Detects synchronous event-loop stalls and logs them at WARN so they reach
 * the file log (INFO stays console-only in dev). Instrumentation for the
 * recurring ~9.5s silent stalls captured daily at 06:00 (2026-09-03/04,
 * concern #514/#868): a WARN with the lag size next to the surrounding job
 * logs names the culprit. Detection only — never mitigates anything itself.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('event-loop-lag');

const CHECK_INTERVAL_MS = 500;
const REPORT_THRESHOLD_MS = 2000;

let handle: ReturnType<typeof setInterval> | null = null;

/**
 * Formats the stall message with a fixed one-decimal-place digit shape (e.g.
 * "2.0" not "2") so log-health-check's normalizeMessage() always folds these
 * into the same "~#.#s" signature instead of splitting integer-second lags
 * into a separate concern series (task #864).
 */
export function formatEventLoopLagMessage(lagMs: number): string {
  return `Event loop stalled ~${(lagMs / 1000).toFixed(1)}s`;
}

/** Start the watchdog. Safe to call multiple times. */
export function startEventLoopLagWatchdog(): void {
  if (handle) return;
  let expected = Date.now() + CHECK_INTERVAL_MS;
  handle = setInterval(() => {
    const now = Date.now();
    const lagMs = now - expected;
    expected = now + CHECK_INTERVAL_MS;
    if (lagMs > REPORT_THRESHOLD_MS) {
      log.warn({ lagMs }, formatEventLoopLagMessage(lagMs));
    }
  }, CHECK_INTERVAL_MS);
}

/** Stop the watchdog (tests / shutdown). */
export function stopEventLoopLagWatchdog(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}
