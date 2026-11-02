/**
 * startup-readiness.test
 *
 * The incident this encodes (#1323, measured 2026-10-31 in CI): `/health`
 * answered `{"status":"healthy","database":"connected"}` while the post-listen
 * warm-up was still running, and a write arriving in that window failed with
 * `SQLITE_IOERR_SHORT_READ (522)`. Five of seven fault-injection scenarios
 * failed that way. The window is real and deliberate — warm-up runs after the
 * listener opens on purpose — so the fix is to stop reporting it as ready.
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  getReadinessSnapshot,
  isWarmupComplete,
  markWarmupComplete,
  markWarmupStage,
  resetReadinessForTests,
} from './startup-readiness';

beforeEach(() => {
  resetReadinessForTests();
});

describe('before warm-up finishes', () => {
  it('is not ready', () => {
    expect(isWarmupComplete()).toBe(false);
    expect(getReadinessSnapshot().ready).toBe(false);
  });

  it('names the task in flight, so a warm-up that hangs is identifiable', () => {
    markWarmupStage('startup-backfills');
    expect(getReadinessSnapshot().warmupStage).toBe('startup-backfills');
  });

  it('reports the latest stage, not the first', () => {
    markWarmupStage('memory-system');
    markWarmupStage('agent-worker-manager');
    expect(getReadinessSnapshot().warmupStage).toBe('agent-worker-manager');
  });

  it('has no readiness latency yet', () => {
    markWarmupStage('memory-system');
    expect(getReadinessSnapshot().readyAfterMs).toBeNull();
  });
});

describe('once warm-up finishes', () => {
  it('is ready and reports no stage in flight', () => {
    markWarmupStage('backlog-scheduler');
    markWarmupComplete();

    const snapshot = getReadinessSnapshot();
    expect(snapshot.ready).toBe(true);
    expect(snapshot.warmupStage).toBeNull();
  });

  it('reports how long the window lasted', () => {
    markWarmupComplete();
    const { readyAfterMs } = getReadinessSnapshot();
    expect(typeof readyAfterMs).toBe('number');
    expect(readyAfterMs).toBeGreaterThanOrEqual(0);
  });

  // A late or repeated call must not reopen the window: a consumer that has
  // already been told "ready" cannot un-learn it, and the recorded latency is
  // a measurement, not a running counter.
  it('is idempotent — a second call changes nothing', () => {
    markWarmupComplete();
    const first = getReadinessSnapshot().readyAfterMs;

    markWarmupStage('something-late');
    markWarmupComplete();

    const after = getReadinessSnapshot();
    expect(after.ready).toBe(true);
    expect(after.readyAfterMs).toBe(first);
    // A ready server never names a stage, even when a late marker arrives.
    expect(after.warmupStage).toBeNull();
  });
});
