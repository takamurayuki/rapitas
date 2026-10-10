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
 * @param prefix - Log prefix, e.g. '[restart]' / ログ接頭辞
 * @param steps - Injected steps / 注入されるステップ
 */
export async function runShutdownSteps(prefix: string, steps: ShutdownSteps): Promise<void> {
  log.info(`${prefix} Closing listening socket first for quick port release...`);
  await guarded(prefix, 'stopServer', () => steps.stopServer());
  log.info(`${prefix} Listening socket closed, port released.`);

  log.info(`${prefix} Closing all SSE connections...`);
  await guarded(prefix, 'closeRealtime', () => steps.closeRealtime());

  // Preview servers spawned for runtime smoke inherit this process's listening
  // socket handle; one left alive keeps port 3001 LISTENING after we exit and
  // blocks the supervisor's respawn (2026-09-13, task 910). Closing our own
  // socket above does not release theirs, so this step is still required.
  log.info(`${prefix} Stopping owned runtime-smoke servers...`);
  await guarded(prefix, 'stopRuntimeServers', async () => {
    const runtime = await steps.stopRuntimeServers();
    log.info({ runtime }, `${prefix} Runtime-smoke servers handled.`);
  });

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
    const watchdog = setTimeout(() => {
      log.error({ exitCode }, `${prefix} Shutdown watchdog fired — forcing process exit`);
      process.exit(exitCode);
    }, SHUTDOWN_WATCHDOG_MS);
    try {
      await runShutdownSteps(prefix, {
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
      });
    } catch (error) {
      log.error({ err: error }, `${prefix} Graceful shutdown error`);
    } finally {
      clearTimeout(watchdog);
      log.info({ exitCode }, `${prefix} Exiting process...`);
      setTimeout(() => process.exit(exitCode), 200);
    }
  }, 300);
}
