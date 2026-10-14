/**
 * ShutdownSequence
 *
 * Shared graceful-shutdown sequence (release listening socket → close SSE →
 * stop runtime-smoke servers → stop agents → exit). Extracted from
 * agent-system-router.ts so both the /shutdown and /restart routes and the
 * auto-restart-merged-code scheduler can trigger the exact same exit path.
 * Not responsible for deciding WHEN to shut down — callers own that.
 */
import { stopServer } from '../core/orchestrator-instance';
import { shutdownExecutionOwners } from './shutdown-execution-owners';
import { realtimeService } from '../communication/realtime-service';
import { createLogger } from '../../config/logger';

const log = createLogger('services:shutdown-sequence');

// Upper bound for the whole sequence. Generous enough for gracefulShutdown to
// stop agents and save state.
const SHUTDOWN_WATCHDOG_MS = 30_000;

/** The shutdown steps, injected so their ORDER can be pinned by tests. */
export interface ShutdownSteps {
  /** Close the listening socket and force-close live connections. */
  stopServer: () => Promise<void>;
  /** Close all SSE streams. */
  closeRealtime: () => void;
  /** Stop preview servers spawned for runtime smoke. */
  stopRuntimeServers: () => Promise<unknown>;
  /** Stop agents and persist their state. */
  shutdownExecutionOwners: () => Promise<void>;
}

/** Runs one step without letting its failure skip the steps after it. */
async function guarded(prefix: string, name: string, run: () => unknown): Promise<void> {
  try {
    await run();
  } catch (err) {
    log.error({ err }, `${prefix} Shutdown step failed: ${name}`);
  }
}

/** Optional extras for {@link runShutdownSteps}, injected so tests can pin them. */
export interface ShutdownBudget {
  /** Whether the whole-sequence budget is already spent. / 予算を使い切ったか */
  exceeded: () => boolean;
  /**
   * Called as soon as the budget is found spent, instead of starting the next
   * step. Expected to end the process; if it returns, the remaining steps are
   * skipped anyway.
   */
  onExhausted: (skipped: string[]) => void;
}

/** Step order, so a skip can report what it gave up on. */
const STEP_ORDER = [
  'stopServer',
  'closeRealtime',
  'stopRuntimeServers',
  'shutdownExecutionOwners',
] as const;

/**
 * Run the shutdown steps in the order that survives a forced exit.
 *
 * NOTE: `stopServer()` goes FIRST, and that ordering is the point of this
 * function. Measured 2026-10-10: the event-loop watchdog triggered a self-heal
 * restart, the steps ahead of `stopServer()` consumed the entire 30s budget
 * because the loop was saturated, and the caller's watchdog called
 * `process.exit` with the socket still open. The result was a LISTEN socket
 * owned by a dead PID whose accept queue then filled, so every connection to
 * port 3001 was refused — and it survived three further automatic restarts.
 * Releasing the socket before anything else means a forced exit can still lose
 * agent state, but never the port.
 *
 * `stopServer()` is bounded by its own internal race, so leading with it cannot
 * delay the rest. Each step is guarded individually: a shutdown that gives up
 * halfway leaves more behind than one that keeps going.
 *
 * The optional `budget` closes the one hole the 2026-10-11 restart fell into:
 * every exit path here is a TIMER, and a saturated event loop never reaches a
 * timer. The /restart that left a 531MB process alive with 36 CloseWait
 * sockets and no usable listener had its watchdog armed and simply never got
 * the loop back. Checking the deadline BETWEEN steps means the first step that
 * does return triggers the exit, instead of waiting for a timer that will not
 * fire. It can only make the process exit sooner than the watchdog already
 * intended, never later.
 *
 * @param prefix - Log prefix, e.g. '[restart]' / ログ接頭辞
 * @param steps - Injected steps / 注入されるステップ
 * @param budget - Deadline check applied between steps / ステップ間の期限判定
 */
export async function runShutdownSteps(
  prefix: string,
  steps: ShutdownSteps,
  budget?: ShutdownBudget,
): Promise<void> {
  /** True when the budget is spent; reports the steps being abandoned. */
  const outOfBudget = (doneCount: number): boolean => {
    if (!budget?.exceeded()) return false;
    const skipped = STEP_ORDER.slice(doneCount);
    log.error(
      { skipped },
      `${prefix} Shutdown budget spent — exiting now instead of starting the remaining steps`,
    );
    budget.onExhausted([...skipped]);
    return true;
  };

  log.info(`${prefix} Closing listening socket first for quick port release...`);
  await guarded(prefix, 'stopServer', () => steps.stopServer());
  log.info(`${prefix} Listening socket closed, port released.`);
  if (outOfBudget(1)) return;

  log.info(`${prefix} Closing all SSE connections...`);
  await guarded(prefix, 'closeRealtime', () => steps.closeRealtime());
  if (outOfBudget(2)) return;

  // Preview servers spawned for runtime smoke inherit this process's listening
  // socket handle; one left alive keeps port 3001 LISTENING after we exit and
  // blocks the supervisor's respawn (2026-09-13, task 910). Closing our own
  // socket above does not release theirs, so this step is still required.
  log.info(`${prefix} Stopping owned runtime-smoke servers...`);
  await guarded(prefix, 'stopRuntimeServers', async () => {
    const runtime = await steps.stopRuntimeServers();
    log.info({ runtime }, `${prefix} Runtime-smoke servers handled.`);
  });
  if (outOfBudget(3)) return;

  log.info(`${prefix} Stopping agents and saving state...`);
  await guarded(prefix, 'shutdownExecutionOwners', () => steps.shutdownExecutionOwners());
  log.info(`${prefix} Agent shutdown completed.`);
}

/**
 * Schedule the common shutdown sequence and exit with the given code.
 * Shared by /shutdown, /restart and the event-loop self-heal.
 *
 * A watchdog forces the exit if any step never settles — a hung await here
 * previously left the process alive with no listener, so the restart the user
 * requested silently never happened.
 *
 * @param prefix - Log prefix, e.g. '[restart]' / ログ接頭辞
 * @param exitCode - Process exit code (75 tells dev.js to restart) / 終了コード
 */
export function scheduleShutdownSequence(prefix: string, exitCode: number): void {
  setTimeout(async () => {
    const deadline = Date.now() + SHUTDOWN_WATCHDOG_MS;
    const watchdog = setTimeout(() => {
      log.error({ exitCode }, `${prefix} Shutdown watchdog fired — forcing process exit`);
      process.exit(exitCode);
    }, SHUTDOWN_WATCHDOG_MS);
    let exited = false;
    /** Exit without waiting on another timer — see runShutdownSteps' budget note. */
    const exitNow = (why: string): void => {
      if (exited) return;
      exited = true;
      clearTimeout(watchdog);
      log.error({ exitCode, why }, `${prefix} Exiting process immediately`);
      process.exit(exitCode);
    };
    try {
      await runShutdownSteps(
        prefix,
        {
          stopServer,
          closeRealtime: () => realtimeService.shutdown(),
          // Dynamic import keeps the runtime-smoke graph out of this module's
          // static dependencies.
          stopRuntimeServers: async () => {
            const { stopAllRuntimeServersForShutdown } =
              await import('../agents/verification/runtime-smoke/runtime-server-shutdown');
            return stopAllRuntimeServersForShutdown(`${prefix} shutdown`);
          },
          shutdownExecutionOwners,
        },
        {
          exceeded: () => Date.now() >= deadline,
          onExhausted: (skipped) => exitNow(`budget spent, skipped: ${skipped.join(',')}`),
        },
      );
    } catch (error) {
      log.error({ err: error }, `${prefix} Graceful shutdown error`);
    } finally {
      if (!exited) {
        clearTimeout(watchdog);
        log.info({ exitCode }, `${prefix} Exiting process...`);
        // The 200ms lets the log flush. A second timer in case the loop is too
        // busy to run this one is pointless, so the deadline check above is
        // what actually covers that case.
        setTimeout(() => process.exit(exitCode), 200);
      }
    }
  }, 300);
}
