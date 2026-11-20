/**
 * descendant-tracker.test
 *
 * Task 514 (2026-11-20): a Codex implementer started trendline's dev stack
 * (`node scripts/dev-all.mjs` → server.exe, worker.exe, next dev) from a bash
 * that exited soon after. When the agent closed, the descendant capture saw
 * no link to the stack, so it outlived the run, held port 3100 for the next
 * one and the backend's own LISTEN handle across a restart — a ghost socket
 * that took the whole app down.
 */
import { describe, expect, test } from 'bun:test';
import { trackDescendants } from './descendant-tracker';
import type { ProcessSnapshotEntry } from './process-tree-kill';

const ROOT = 100;
const proc = (pid: number, ppid: number, cmd: string): ProcessSnapshotEntry => ({ pid, ppid, cmd });

/** A clock-free tracker: samples are taken when the test calls `tick`. */
function harness(snapshots: ProcessSnapshotEntry[][]) {
  let i = 0;
  let tick: () => void = () => {};
  const tracker = trackDescendants(ROOT, {
    snapshot: () => snapshots[Math.min(i, snapshots.length - 1)],
    schedule: (fn) => {
      tick = fn;
      return () => {};
    },
  });
  return {
    tracker,
    next: () => {
      i += 1;
      tick();
    },
  };
}

describe('trackDescendants', () => {
  test('keeps a process whose intermediate shell exited before the agent closed', () => {
    const { tracker, next } = harness([
      // mid-run: agent → bash → node dev-all → server.exe
      [
        proc(ROOT, 1, 'codex exec'),
        proc(200, ROOT, 'bash -c start.sh'),
        proc(300, 200, 'node scripts/dev-all.mjs 3100'),
        proc(301, 300, 'C:\wt\server.exe'),
      ],
      // at close: bash is gone, the stack lives on with a dead parent
      [
        proc(ROOT, 1, 'codex exec'),
        proc(300, 200, 'node scripts/dev-all.mjs 3100'),
        proc(301, 300, 'C:\wt\server.exe'),
      ],
    ]);
    next();
    expect([...tracker.stop()].sort()).toEqual([300, 301]);
  });

  test('drops a tracked pid that now belongs to a different command (PID reuse)', () => {
    const { tracker, next } = harness([
      [proc(ROOT, 1, 'codex exec'), proc(300, ROOT, 'node scripts/dev-all.mjs 3100')],
      [proc(ROOT, 1, 'codex exec'), proc(300, 4, 'C:\Windows\explorer.exe')],
    ]);
    next();
    expect([...tracker.stop()]).toEqual([]);
  });

  test('stops sampling once stopped', () => {
    let cancelled = false;
    const tracker = trackDescendants(ROOT, {
      snapshot: () => [proc(ROOT, 1, 'codex exec')],
      schedule: () => () => {
        cancelled = true;
      },
    });
    tracker.stop();
    expect(cancelled).toBe(true);
  });
});

describe('captureTrackedDescendants', () => {
  test('returns what the run recorded, even when the teardown capture cannot reach it', async () => {
    const { startTrackingDescendants, stopTrackingDescendants, captureTrackedDescendants } =
      await import('./descendant-tracker');
    const PID = 987_654; // no such process: the fresh capture finds nothing
    let tick: () => void = () => {};
    let phase = 0;
    startTrackingDescendants(PID, {
      snapshot: () =>
        phase === 0
          ? [proc(PID, 1, 'codex exec'), proc(5000, PID, 'node scripts/dev-all.mjs 3100')]
          : [proc(5000, 4242, 'node scripts/dev-all.mjs 3100')],
      schedule: (fn) => {
        tick = fn;
        return () => {};
      },
    });
    tick();
    phase = 1;
    stopTrackingDescendants(PID);
    expect([...captureTrackedDescendants(PID)]).toContain(5000);
  });
});
