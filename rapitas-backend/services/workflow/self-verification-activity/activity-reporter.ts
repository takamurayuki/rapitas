/**
 * Self-Verification Activity Reporter
 *
 * Per-execution view of the activity store for an agent watchdog: tells it
 * whether self-verification is running in its worktree, emits the
 * `[SelfVerification] waiting` / `result` lines the screen orders the
 * completion line by, and waits for the verdict after the CLI has exited.
 * Not responsible for killing anything — the watchdogs decide that.
 */
import { createLogger } from '../../../config/logger';
import {
  getActivityStore,
  type ActivityStore,
  type SelfVerificationActivity,
} from './activity-store';

const log = createLogger('services:workflow:self-verification-reporter');

/** Runs that began this long before the execution still belong to it (clock skew, quick POST). */
const OWN_RUN_GRACE_MS = 5_000;

/** Default interval between checks while waiting for the verdict after the CLI exited. */
const DEFAULT_SETTLE_POLL_MS = 2_000;

/** Clock and interval primitives a watchdog uses; injectable so tests can drive time. */
export interface MonitorClock {
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

/** Real timers. */
export const REAL_MONITOR_CLOCK: MonitorClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Options for {@link createSelfVerificationReporter}. */
export interface SelfVerificationReporterOptions {
  /** Worktree the agent works in; undefined disables the reporter. */
  workDir: string | undefined;
  /** When this agent execution started (ms epoch). */
  executionStartedAt: number;
  /** Display-only sink for the marker lines (never the parsed output buffer). */
  emit: (line: string) => void;
  store?: ActivityStore;
  sleep?: (ms: number) => Promise<void>;
}

/** Handle used by one watchdog. */
export interface SelfVerificationReporter {
  /** Emit waiting/result lines for runs not yet reported. */
  tick: () => void;
  /** Whether any self-verification is running in the worktree right now. */
  isActive: () => boolean;
  /** Wait until no self-verification is running or a stop was requested. */
  waitUntilSettled: (opts: {
    isCancelled: () => boolean;
    pollMs?: number;
  }) => Promise<'settled' | 'cancelled'>;
}

/**
 * Line announcing that a run is in flight.
 *
 * @param runId - Verification run id / 検証ジョブID
 * @returns Log line ending in a newline / 改行付きのログ行
 */
export function formatWaitingLine(runId: string): string {
  return `[SelfVerification] waiting runId=${runId}\n`;
}

/**
 * Line carrying a finished run's verdict and check counts.
 *
 * @param r - Finished record / 終了した記録
 * @returns Log line ending in a newline / 改行付きのログ行
 */
export function formatResultLine(r: SelfVerificationActivity): string {
  return (
    `[SelfVerification] result runId=${r.runId} ok=${r.ok === true} ` +
    `unverifiable=${r.unverifiable === true} passed=${r.passed ?? 0} failed=${r.failed ?? 0}\n`
  );
}

/**
 * Create the reporter for one agent execution.
 *
 * @param opts - Worktree, execution start, emit sink / worktree・開始時刻・出力先
 * @returns Reporter handle / レポーター
 */
export function createSelfVerificationReporter(
  opts: SelfVerificationReporterOptions,
): SelfVerificationReporter {
  const store = opts.store ?? getActivityStore();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const announcedWaiting = new Set<string>();
  const announcedResult = new Set<string>();

  const list = (): SelfVerificationActivity[] => {
    if (!opts.workDir) return [];
    try {
      return store.listForWorktree(opts.workDir);
    } catch (err) {
      // A watchdog must never die on a marker read; unreadable means "not running".
      log.warn({ err }, '[self-verification] marker read failed');
      return [];
    }
  };

  const tick = () => {
    for (const r of list()) {
      if (r.startedAt < opts.executionStartedAt - OWN_RUN_GRACE_MS) continue;
      if (!announcedWaiting.has(r.runId)) {
        announcedWaiting.add(r.runId);
        opts.emit(formatWaitingLine(r.runId));
      }
      if (r.state === 'finished' && !announcedResult.has(r.runId)) {
        announcedResult.add(r.runId);
        opts.emit(formatResultLine(r));
      }
    }
  };

  // Earlier runs count here on purpose: a gate still running must be protected
  // even when it was started by a previous execution in the same worktree.
  const isActive = () => list().some((r) => store.isRunning(r));

  return {
    tick,
    isActive,
    async waitUntilSettled({ isCancelled, pollMs = DEFAULT_SETTLE_POLL_MS }) {
      for (;;) {
        tick();
        if (isCancelled()) return 'cancelled';
        if (!isActive()) {
          tick();
          return 'settled';
        }
        await sleep(pollMs);
      }
    },
  };
}
