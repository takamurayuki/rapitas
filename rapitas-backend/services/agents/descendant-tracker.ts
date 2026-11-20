/**
 * descendant-tracker
 *
 * Remembers an agent CLI's descendants for the whole run, so its teardown can
 * kill what the agent started even after the parent links are gone. Not
 * responsible for the kill itself (agent-process-tracker's
 * killProcessTreeSafely) or for the backend's own protection.
 *
 * Why a run-long record: capturing only at close misses a process whose
 * intermediate shell already exited. Task 514 (2026-11-20) had a Codex
 * implementer start trendline's dev stack from a bash that exited first; the
 * stack outlived the run, held port 3100 for the next one, and kept the
 * backend's inherited LISTEN handle across a restart — a ghost socket that
 * took the whole app down.
 */
import {
  collectKillTargets,
  listWindowsProcessSnapshot,
  type ProcessSnapshotEntry,
} from './process-tree-kill';

/** How often the descendants are re-read during a run. */
export const DESCENDANT_SAMPLE_MS = 30_000; // each sample is a full CIM process listing

/** Injectable pieces, so tests need neither a clock nor a real process table. */
export interface DescendantTrackerDeps {
  snapshot?: () => ProcessSnapshotEntry[];
  /** Runs `fn` repeatedly; returns a cancel function. */
  schedule?: (fn: () => void) => () => void;
}

/** A running record of one agent's descendants. */
export interface DescendantTracker {
  /** Stop sampling and return the descendants still alive as the same command. */
  stop: () => Set<number>;
}

function defaultSchedule(fn: () => void): () => void {
  const timer = setInterval(fn, DESCENDANT_SAMPLE_MS);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

/**
 * Start recording `rootPid`'s descendants.
 *
 * Each sample adds the descendants reachable at that moment, keyed by pid with
 * the command line seen. `stop` takes one last sample and keeps only pids whose
 * current command line is the one recorded, so a pid Windows handed to an
 * unrelated process since is never returned.
 *
 * @param rootPid - The agent CLI's process id / エージェント CLI の PID
 * @param deps - Injectable snapshot and scheduler / テスト用の注入
 * @returns The tracker / 追跡器
 */
export function trackDescendants(
  rootPid: number,
  deps: DescendantTrackerDeps = {},
): DescendantTracker {
  const isWindows = process.platform === 'win32' || deps.snapshot !== undefined;
  const snapshot = deps.snapshot ?? listWindowsProcessSnapshot;
  const seen = new Map<number, string>();

  const sample = (): ProcessSnapshotEntry[] => {
    if (!isWindows) return [];
    const snap = snapshot();
    const cmdOf = new Map(snap.map((e) => [e.pid, e.cmd]));
    for (const pid of collectKillTargets(snap, rootPid)) {
      if (!seen.has(pid)) seen.set(pid, cmdOf.get(pid) ?? '');
    }
    return snap;
  };

  sample();
  const cancel = (deps.schedule ?? defaultSchedule)(() => {
    sample();
  });

  return {
    stop: () => {
      cancel();
      const now = sample();
      const current = new Map(now.map((e) => [e.pid, e.cmd]));
      const alive = new Set<number>();
      for (const [pid, cmd] of seen) {
        if (current.get(pid) === cmd) alive.add(pid);
      }
      return alive;
    },
  };
}

/** Trackers running per agent pid, started alongside resource sampling. */
const running = new Map<number, DescendantTracker>();
/** Results of stopped trackers, waiting for the teardown's capture. */
const finished = new Map<number, Set<number>>();
/** How long a stopped tracker's result waits for its capture before it is dropped. */
const FINISHED_TTL_MS = 10 * 60_000;

/**
 * Start recording an agent CLI's descendants for its whole run.
 *
 * @param pid - Agent CLI process id / エージェント CLI の PID
 * @param deps - Injectable snapshot and scheduler / テスト用の注入
 */
export function startTrackingDescendants(pid: number, deps: DescendantTrackerDeps = {}): void {
  if (running.has(pid)) return;
  running.set(pid, trackDescendants(pid, deps));
}

/**
 * Stop recording; the result is kept for {@link captureTrackedDescendants}.
 *
 * @param pid - Agent CLI process id / エージェント CLI の PID
 */
export function stopTrackingDescendants(pid: number): void {
  const tracker = running.get(pid);
  if (!tracker) return;
  running.delete(pid);
  finished.set(pid, tracker.stop());
  const drop = setTimeout(() => finished.delete(pid), FINISHED_TTL_MS);
  (drop as { unref?: () => void }).unref?.();
}

/**
 * Descendants to kill at an agent's teardown: those reachable now, plus any
 * recorded during the run that are still the same command.
 *
 * Drop-in for process-tree-kill's captureDescendants, which only sees what is
 * reachable at the moment of the call.
 *
 * @param rootPid - Agent CLI process id / エージェント CLI の PID
 * @param workdir - Optional launch cwd for command-line orphan matching / 起動時cwd
 * @returns Descendant pids / 子孫PID
 */
export function captureTrackedDescendants(rootPid: number, workdir?: string): Set<number> {
  if (running.has(rootPid)) stopTrackingDescendants(rootPid);
  const recorded = finished.get(rootPid) ?? new Set<number>();
  finished.delete(rootPid);
  const now = new Set<number>(recorded);
  if (process.platform === 'win32') {
    const snap = listWindowsProcessSnapshot();
    if (snap.length > 0) for (const pid of collectKillTargets(snap, rootPid, workdir)) now.add(pid);
  }
  return now;
}
