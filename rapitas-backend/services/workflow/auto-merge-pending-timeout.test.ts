/**
 * auto-merge-pending-timeout tests
 *
 * A PR that is no longer open on GitHub must not be reported as a CI timeout.
 */
import { describe, expect, it, mock } from 'bun:test';
import {
  handlePendingTimeout,
  PENDING_TIMEOUT_MS,
  type PendingTimeoutDeps,
} from './auto-merge-pending-timeout';
import type { Candidate } from './auto-merge-candidates';

const NOW = 1_800_000_000_000;

function candidate(waitedMs: number): Candidate {
  return {
    taskId: 1528,
    taskTitle: 't',
    prNumber: 26,
    baseBranch: 'develop',
    cwd: 'C:/repo',
    threshold: 0,
    completedAt: new Date(NOW - waitedMs),
    mode: 'merge',
  };
}

function deps(prState: string | null): PendingTimeoutDeps & {
  mark: ReturnType<typeof mock>;
  notify: ReturnType<typeof mock>;
  syncLocalState: ReturnType<typeof mock>;
} {
  return {
    now: () => NOW,
    readPrState: mock(() => Promise.resolve(prState)),
    syncLocalState: mock(() => Promise.resolve()),
    mark: mock(() => Promise.resolve()),
    notify: mock(() => Promise.resolve()),
  };
}

// 2026-11-22: trendline task 1528's PR #26 was merged by hand. The local PR
// row stayed 'open' (the reconciler re-asks GitHub at most every 6 h), so the
// watcher kept treating it as a candidate whose CI never finished and recorded
// "auto_merge_blocked: ci timeout" with a timeout notification three times.
describe('handlePendingTimeout', () => {
  it('waits silently inside the timeout window, without asking GitHub', async () => {
    const d = deps('open');
    expect(await handlePendingTimeout(candidate(PENDING_TIMEOUT_MS - 1), d)).toBe('waiting');
    expect(d.readPrState).not.toHaveBeenCalled();
    expect(d.mark).not.toHaveBeenCalled();
  });

  it('syncs a PR merged outside the app instead of declaring a CI timeout', async () => {
    const d = deps('merged');
    expect(await handlePendingTimeout(candidate(PENDING_TIMEOUT_MS + 1), d)).toBe('settled');
    expect(d.syncLocalState).toHaveBeenCalledWith(1528, 26, 'merged', 'C:/repo');
    expect(d.mark).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('syncs a PR closed outside the app the same way', async () => {
    const d = deps('closed');
    expect(await handlePendingTimeout(candidate(PENDING_TIMEOUT_MS + 1), d)).toBe('settled');
    expect(d.syncLocalState).toHaveBeenCalledWith(1528, 26, 'closed', 'C:/repo');
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('declares the timeout for a PR that is still open', async () => {
    const d = deps('open');
    expect(await handlePendingTimeout(candidate(PENDING_TIMEOUT_MS + 1), d)).toBe('timed_out');
    expect(d.mark).toHaveBeenCalledWith(1528, 'auto_merge_blocked', 'ci timeout');
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.syncLocalState).not.toHaveBeenCalled();
  });

  it('still declares the timeout when GitHub cannot be read', async () => {
    const d = deps(null);
    expect(await handlePendingTimeout(candidate(PENDING_TIMEOUT_MS + 1), d)).toBe('timed_out');
    expect(d.mark).toHaveBeenCalledTimes(1);
  });
});
