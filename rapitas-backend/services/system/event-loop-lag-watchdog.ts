/**
 * event-loop-lag-watchdog
 *
 * Detects synchronous event-loop stalls and logs them at WARN so they reach
 * the file log (INFO stays console-only in dev). Instrumentation for the
 * recurring ~9.5s silent stalls captured daily at 06:00 (2026-09-03/04,
 * concern #514/#868): a WARN with the lag size next to the surrounding job
 * logs names the culprit.
 *
 * Also self-heals a pathological stall (2026-09-18 incident): a runaway
 * verify-repair loop starved the event loop badly enough that /health never
 * responded for 90+ minutes across three restarts. The operator's only
 * remaining lever was an external OS-level kill of the hung process — which
 * bypasses this app's own graceful shutdown (close listening socket → close
 * SSE → stop agents) and is exactly how port 3001 accumulated orphaned
 * "ghost" LISTEN sockets that never got cleaned up, on top of the original
 * problem. A process that is still ticking (this watchdog's own interval
 * still fires) can always call its OWN graceful shutdown — releasing the
 * port itself is strictly safer than requiring anyone outside the process to
 * force-kill it. Only a FULLY deadlocked event loop (this watchdog's own
 * timer never fires again) is outside what this can catch; that case has no
 * pure-JS remedy and still needs an external actor.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('event-loop-lag');

const CHECK_INTERVAL_MS = 500;
const REPORT_THRESHOLD_MS = 2000;
/**
 * A single stall at least this long is pathological on its own — a normal
 * GC pause or heavy-but-legitimate synchronous burst does not run this long
 * in one shot. Self-heal immediately rather than waiting for more evidence.
 */
const CATASTROPHIC_STALL_MS = 15_000;
/** Sliding window for the cumulative-degradation trigger. */
const CUMULATIVE_WINDOW_MS = 120_000;
/**
 * If stalls over REPORT_THRESHOLD_MS sum to at least this much within
 * CUMULATIVE_WINDOW_MS, the process has been unresponsive often enough to be
 * effectively down even without any single catastrophic stall (this is the
 * shape the 2026-09-18 incident actually took: repeated 3-4s stalls, not one
 * giant one).
 */
const CUMULATIVE_TRIGGER_MS = 30_000;

/** Invoked at most once per watchdog run, when a stall crosses a self-heal threshold. */
export type SelfHealAction = (reason: string) => void;

/**
 * Dynamic import keeps shutdown-sequence.ts (and its Prisma/realtime-service
 * chain) out of this module's static graph — this file must stay importable
 * in isolation for the lag-detection unit tests, which never hit this path.
 */
const defaultSelfHeal: SelfHealAction = (reason) => {
  log.error({ reason }, '[event-loop-lag] Self-healing restart triggered');
  import('./shutdown-sequence')
    .then(({ scheduleShutdownSequence }) => scheduleShutdownSequence('[event-loop-recovery]', 75))
    .catch((err) => log.error({ err }, '[event-loop-lag] Failed to trigger self-heal restart'));
};

let handle: ReturnType<typeof setInterval> | null = null;
let recentStalls: Array<{ atMs: number; lagMs: number }> = [];
let healingTriggered = false;

/**
 * Formats the stall message with a fixed one-decimal-place digit shape (e.g.
 * "2.0" not "2") so log-health-check's normalizeMessage() always folds these
 * into the same "~#.#s" signature instead of splitting integer-second lags
 * into a separate concern series (task #864).
 */
export function formatEventLoopLagMessage(lagMs: number): string {
  return `Event loop stalled ~${(lagMs / 1000).toFixed(1)}s`;
}

/**
 * Start the watchdog. Safe to call multiple times.
 *
 * @param selfHeal - Called at most once, when a stall crosses a self-heal
 *   threshold; defaults to the real graceful-restart sequence. Tests inject
 *   a spy instead. / 自己修復アクション(テストではスパイに差し替え)
 */
export function startEventLoopLagWatchdog(selfHeal: SelfHealAction = defaultSelfHeal): void {
  if (handle) return;
  recentStalls = [];
  healingTriggered = false;
  let expected = Date.now() + CHECK_INTERVAL_MS;
  handle = setInterval(() => {
    const now = Date.now();
    const lagMs = now - expected;
    expected = now + CHECK_INTERVAL_MS;
    if (lagMs > REPORT_THRESHOLD_MS) {
      log.warn({ lagMs }, formatEventLoopLagMessage(lagMs));
      recentStalls.push({ atMs: now, lagMs });
      recentStalls = recentStalls.filter((stall) => now - stall.atMs <= CUMULATIVE_WINDOW_MS);
      if (!healingTriggered) {
        if (lagMs >= CATASTROPHIC_STALL_MS) {
          healingTriggered = true;
          selfHeal(`single stall of ${lagMs}ms reached the ${CATASTROPHIC_STALL_MS}ms threshold`);
        } else {
          const cumulativeMs = recentStalls.reduce((sum, stall) => sum + stall.lagMs, 0);
          if (cumulativeMs >= CUMULATIVE_TRIGGER_MS) {
            healingTriggered = true;
            selfHeal(
              `cumulative stall of ${cumulativeMs}ms within the last ${CUMULATIVE_WINDOW_MS}ms reached the ${CUMULATIVE_TRIGGER_MS}ms threshold`,
            );
          }
        }
      }
    }
  }, CHECK_INTERVAL_MS);
}

/** Stop the watchdog (tests / shutdown). */
export function stopEventLoopLagWatchdog(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  recentStalls = [];
  healingTriggered = false;
}
