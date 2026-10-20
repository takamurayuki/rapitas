/**
 * deploy-now.test
 *
 * Deploying on request. The point of this path is that the timing gates do
 * not apply and the safety gates do, so that is what is tested: a system in
 * the middle of work is refused with the blockers named, and a quiet one
 * deploys no matter how recently it last restarted or how recently the UI
 * was touched.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** What the stand-in git layer reports. */
let ahead: number | null = 3;
let clean = true;
let fastForwarded = true;
/** What the stand-in system looks like. */
let snapshot = {
  activeExecutions: 0,
  runningExecutions: 0,
  queueDepth: 0,
  isShuttingDown: false,
  activeExecutionsDegraded: false,
};
let auxChildren = 0;
let merging = false;
/** What happened. */
let pulled = false;
let shutdown: string | null = null;
let notified = false;

mock.module('./git-io', () => ({
  fetchAndCountAhead: async () => ahead,
  isWorkingTreeClean: async () => clean,
  fastForwardToRemote: async () => {
    pulled = fastForwarded;
    return fastForwarded;
  },
}));

mock.module('../../../routes/agents/system/agent-system-router', () => ({
  getAgentSystemSnapshot: async () => snapshot,
}));

mock.module('../../agents/agent-process-tracker', () => ({
  countLiveTrackedProcesses: () => auxChildren,
}));

mock.module('../../workflow/auto-merge-watcher', () => ({
  AutoMergeWatcher: { getInstance: () => ({ isMerging: () => merging }) },
}));

mock.module('../../communication/notification-service', () => ({
  createNotification: async () => {
    notified = true;
  },
}));

mock.module('../../system/shutdown-sequence', () => ({
  scheduleShutdownSequence: (tag: string) => {
    shutdown = tag;
  },
}));

const { deployNow } = await import('./deploy-now');

beforeEach(() => {
  ahead = 3;
  clean = true;
  fastForwarded = true;
  snapshot = {
    activeExecutions: 0,
    runningExecutions: 0,
    queueDepth: 0,
    isShuttingDown: false,
    activeExecutionsDegraded: false,
  };
  auxChildren = 0;
  merging = false;
  pulled = false;
  shutdown = null;
  notified = false;
});

describe('deploying on request', () => {
  test('pulls and restarts when the system is quiet', async () => {
    const result = await deployNow('abc1234');
    expect(result).toMatchObject({ deployed: true, reason: 'deployed', aheadCount: 3 });
    expect(pulled).toBe(true);
    expect(shutdown).toBe('[deploy-now]');
  });

  test('says so rather than restarting when there is nothing waiting', async () => {
    ahead = 0;
    const result = await deployNow('abc1234');
    expect(result).toMatchObject({ deployed: false, reason: 'nothing-to-activate' });
    expect(shutdown).toBeNull();
    expect(pulled).toBe(false);
  });

  // The whole reason this path exists: the automatic one waits 15 minutes a
  // poll, then two idle polls, then three minutes of UI silence. A request is
  // not a poll, so none of that is consulted here — there is no clock in this
  // function at all, which is what makes it answerable on demand.
  test('consults no clock: not the last restart, not UI activity', async () => {
    const source = await Bun.file(
      new URL('./deploy-now.ts', import.meta.url).pathname.slice(1),
    ).text();
    expect(source).not.toContain('resolveRestartMinIntervalMs');
    expect(source).not.toContain('resolveRestartUiQuietMs');
    expect(source).not.toContain('getLastUiRequestAt');
    expect(source).not.toContain('readDeferCount');
  });

  // The automatic path is governed by a toggle because it acts on its own. A
  // person asking for it is not that, so the toggle does not apply.
  test('does not consult the auto-restart toggle', async () => {
    const source = await Bun.file(
      new URL('./deploy-now.ts', import.meta.url).pathname.slice(1),
    ).text();
    expect(source).not.toContain('readAutoRestartEnabled');
  });

  // Safety gates are the ones that stay. Each must refuse, and must name
  // itself: a refusal nobody can read is how the automatic path hid a stuck
  // deploy for a day.
  test.each([
    ['an agent is running', () => void (snapshot.runningExecutions = 1), 'running-executions'],
    ['an execution is active', () => void (snapshot.activeExecutions = 2), 'active-executions'],
    ['the queue is not empty', () => void (snapshot.queueDepth = 1), 'queue-not-empty'],
    ['a merge is in flight', () => void (merging = true), 'merge-in-flight'],
    ['an aux CLI child is alive', () => void (auxChildren = 1), 'aux-children'],
    ['the process is shutting down', () => void (snapshot.isShuttingDown = true), 'shutting-down'],
  ])('refuses while %s', async (_label, arrange, reason) => {
    arrange();
    const result = await deployNow('abc1234');
    expect(result).toMatchObject({ deployed: false, reason });
    expect(shutdown).toBeNull();
    expect(pulled).toBe(false);
  });

  // Self-dev agents edit the primary checkout; pulling over their work would
  // destroy it. Refused before the fast-forward, not after.
  test('refuses over uncommitted work in the checkout', async () => {
    clean = false;
    const result = await deployNow('abc1234');
    expect(result).toMatchObject({ deployed: false, reason: 'working-tree-dirty' });
    expect(pulled).toBe(false);
    expect(shutdown).toBeNull();
  });

  // A diverged checkout cannot fast-forward. Restarting anyway would relaunch
  // on the same old commit and look like the deploy silently did nothing.
  test('does not restart when the fast-forward fails', async () => {
    fastForwarded = false;
    const result = await deployNow('abc1234');
    expect(result).toMatchObject({ deployed: false, reason: 'fast-forward-failed' });
    expect(shutdown).toBeNull();
  });

  // Without a startup commit there is nothing to compare against: the
  // scheduler never started, which means this is not the dev orchestrator.
  test('refuses when it does not know what it started on', async () => {
    const result = await deployNow(null);
    expect(result).toMatchObject({ deployed: false, reason: 'no-startup-commit' });
    expect(shutdown).toBeNull();
  });

  test('says so when it cannot reach the remote', async () => {
    ahead = null;
    const result = await deployNow('abc1234');
    expect(result).toMatchObject({ deployed: false, reason: 'ahead-unknown' });
    expect(shutdown).toBeNull();
  });

  test('tells the user it is going down before it goes', async () => {
    await deployNow('abc1234');
    expect(notified).toBe(true);
  });
});
