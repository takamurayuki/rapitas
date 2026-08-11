/**
 * index.test (AutoRestartMergedCodeScheduler)
 *
 * Drives runOnce() with every dependency mocked and asserts the exact call
 * order on the success path (fetch → decide → clean-check → ff-merge →
 * final idle recheck → notification → rate-limit stamp → shutdown sequence),
 * plus every early-exit gate.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const callOrder: string[] = [];

// ── Swappable behaviours ─────────────────────────────────────────────────────
let enabled = true;
let aheadCount: number | null = 3;
let clean = true;
let ffOk = true;
let snapshots: Array<{
  isShuttingDown: boolean;
  activeExecutions: number;
  runningExecutions: number;
  queueDepth: number;
}> = [];
let snapshotIndex = 0;
let lastRestartAt = 0;
let notificationFails = false;

const idleSnapshot = {
  isShuttingDown: false,
  activeExecutions: 0,
  runningExecutions: 0,
  queueDepth: 0,
};

// ── Module mocks (before importing the scheduler) ────────────────────────────
mock.module('./git-io', () => ({
  captureStartupCommit: () => {
    callOrder.push('captureStartupCommit');
    return Promise.resolve('startup123');
  },
  fetchAndCountAhead: (startupCommit: string, branch: string) => {
    callOrder.push(`fetchAndCountAhead:${startupCommit}:${branch}`);
    return Promise.resolve(aheadCount);
  },
  isWorkingTreeClean: () => {
    callOrder.push('isWorkingTreeClean');
    return Promise.resolve(clean);
  },
  fastForwardToRemote: (branch: string) => {
    callOrder.push(`fastForwardToRemote:${branch}`);
    return Promise.resolve(ffOk);
  },
}));

mock.module('./settings-store', () => ({
  readAutoRestartEnabled: () => {
    callOrder.push('readAutoRestartEnabled');
    return enabled;
  },
  writeAutoRestartEnabled: () => {},
  readLastRestartAt: () => lastRestartAt,
  writeLastRestartAt: (_ts: number) => {
    callOrder.push('writeLastRestartAt');
  },
}));

mock.module('../../system/shutdown-sequence', () => ({
  scheduleShutdownSequence: (prefix: string, exitCode: number) => {
    callOrder.push(`scheduleShutdownSequence:${prefix}:${exitCode}`);
  },
}));

mock.module('../../communication/notification-service', () => ({
  createNotification: (params: { type: string; title: string; message: string }) => {
    callOrder.push(`createNotification:${params.type}`);
    return notificationFails
      ? Promise.reject(new Error('notification down'))
      : Promise.resolve({ id: 1 });
  },
}));

mock.module('../../../routes/agents/system/agent-system-router', () => ({
  getAgentSystemSnapshot: () => {
    callOrder.push('getAgentSystemSnapshot');
    const snap = snapshots[snapshotIndex] ?? idleSnapshot;
    snapshotIndex += 1;
    return Promise.resolve({
      status: 'healthy',
      interruptedExecutions: 0,
      activePreviewCount: 0,
      serverTime: new Date().toISOString(),
      ...snap,
    });
  },
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { AutoRestartMergedCodeScheduler } = await import('./index');

/** Fresh scheduler with the private startupCommit primed (runOnce is driven directly). */
function makeScheduler(startupCommit: string | null = 'startup123'): {
  runOnce(): Promise<boolean>;
} {
  const scheduler = new AutoRestartMergedCodeScheduler();
  (scheduler as unknown as { startupCommit: string | null }).startupCommit = startupCommit;
  return scheduler;
}

beforeEach(() => {
  callOrder.length = 0;
  enabled = true;
  aheadCount = 3;
  clean = true;
  ffOk = true;
  snapshots = [idleSnapshot, idleSnapshot];
  snapshotIndex = 0;
  lastRestartAt = 0;
  notificationFails = false;
  delete process.env.RAPITAS_PRIMARY_BRANCH;
});

describe('runOnce — success path', () => {
  test('runs fetch → snapshot → clean → ff → recheck → notify → stamp → shutdown in order', async () => {
    const fired = await makeScheduler().runOnce();
    expect(fired).toBe(true);
    expect(callOrder).toEqual([
      'readAutoRestartEnabled',
      'fetchAndCountAhead:startup123:develop',
      'getAgentSystemSnapshot',
      'isWorkingTreeClean',
      'fastForwardToRemote:develop',
      'getAgentSystemSnapshot',
      'createNotification:system',
      'writeLastRestartAt',
      'scheduleShutdownSequence:[auto-restart]:75',
    ]);
  });

  test('honours RAPITAS_PRIMARY_BRANCH for fetch and merge', async () => {
    process.env.RAPITAS_PRIMARY_BRANCH = 'main';
    await makeScheduler().runOnce();
    expect(callOrder).toContain('fetchAndCountAhead:startup123:main');
    expect(callOrder).toContain('fastForwardToRemote:main');
  });
});

describe('runOnce — early-exit gates', () => {
  test('toggle off: no git I/O at all', async () => {
    enabled = false;
    expect(await makeScheduler().runOnce()).toBe(false);
    expect(callOrder).toEqual(['readAutoRestartEnabled']);
  });

  test('missing startup commit: stops before fetch', async () => {
    expect(await makeScheduler(null).runOnce()).toBe(false);
    expect(callOrder).toEqual(['readAutoRestartEnabled']);
  });

  test('fetch failure (null): stops before snapshot', async () => {
    aheadCount = null;
    expect(await makeScheduler().runOnce()).toBe(false);
    expect(callOrder.some((c) => c === 'getAgentSystemSnapshot')).toBe(false);
  });

  test('aheadCount 0: stops before snapshot', async () => {
    aheadCount = 0;
    expect(await makeScheduler().runOnce()).toBe(false);
    expect(callOrder.some((c) => c === 'getAgentSystemSnapshot')).toBe(false);
  });

  test('busy system (decision gate): no pull, no restart', async () => {
    snapshots = [{ ...idleSnapshot, activeExecutions: 1 }];
    expect(await makeScheduler().runOnce()).toBe(false);
    expect(callOrder.some((c) => c === 'isWorkingTreeClean')).toBe(false);
    expect(callOrder.some((c) => c.startsWith('fastForwardToRemote'))).toBe(false);
  });

  test('rate-limited: no pull, no restart', async () => {
    lastRestartAt = Date.now() - 60_000; // 1 min ago < 30 min floor
    expect(await makeScheduler().runOnce()).toBe(false);
    expect(callOrder.some((c) => c === 'isWorkingTreeClean')).toBe(false);
  });

  test('dirty tree: no ff-merge, no notification', async () => {
    clean = false;
    expect(await makeScheduler().runOnce()).toBe(false);
    expect(callOrder.some((c) => c.startsWith('fastForwardToRemote'))).toBe(false);
    expect(callOrder.some((c) => c.startsWith('createNotification'))).toBe(false);
  });

  test('ff-merge failure: no notification, no shutdown', async () => {
    ffOk = false;
    expect(await makeScheduler().runOnce()).toBe(false);
    expect(callOrder.some((c) => c.startsWith('createNotification'))).toBe(false);
    expect(callOrder.some((c) => c.startsWith('scheduleShutdownSequence'))).toBe(false);
  });

  test('busy at final recheck: pull happened but restart deferred (no notification/stamp/shutdown)', async () => {
    snapshots = [idleSnapshot, { ...idleSnapshot, runningExecutions: 1 }];
    expect(await makeScheduler().runOnce()).toBe(false);
    expect(callOrder.some((c) => c.startsWith('fastForwardToRemote'))).toBe(true);
    expect(callOrder.some((c) => c.startsWith('createNotification'))).toBe(false);
    expect(callOrder.some((c) => c === 'writeLastRestartAt')).toBe(false);
    expect(callOrder.some((c) => c.startsWith('scheduleShutdownSequence'))).toBe(false);
  });

  test('isShuttingDown at final recheck: restart deferred (dual-path guard)', async () => {
    snapshots = [idleSnapshot, { ...idleSnapshot, isShuttingDown: true }];
    expect(await makeScheduler().runOnce()).toBe(false);
    expect(callOrder.some((c) => c.startsWith('scheduleShutdownSequence'))).toBe(false);
  });

  test('notification failure does not block the restart', async () => {
    notificationFails = true;
    expect(await makeScheduler().runOnce()).toBe(true);
    expect(callOrder.some((c) => c.startsWith('scheduleShutdownSequence'))).toBe(true);
  });
});

describe('start() guards', () => {
  test('does nothing when TAURI_BUILD != true', async () => {
    const originalTauri = process.env.TAURI_BUILD;
    delete process.env.TAURI_BUILD;
    const scheduler = new AutoRestartMergedCodeScheduler();
    await scheduler.start(60_000);
    expect(scheduler.getIsRunning()).toBe(false);
    expect(callOrder.some((c) => c === 'captureStartupCommit')).toBe(false);
    if (originalTauri !== undefined) process.env.TAURI_BUILD = originalTauri;
  });

  test('starts and stops under TAURI_BUILD=true', async () => {
    const originalTauri = process.env.TAURI_BUILD;
    process.env.TAURI_BUILD = 'true';
    enabled = false; // keep the immediate runOnce a no-op
    const scheduler = new AutoRestartMergedCodeScheduler();
    await scheduler.start(60 * 60 * 1000);
    expect(scheduler.getIsRunning()).toBe(true);
    expect(callOrder).toContain('captureStartupCommit');
    scheduler.stop();
    expect(scheduler.getIsRunning()).toBe(false);
    if (originalTauri === undefined) delete process.env.TAURI_BUILD;
    else process.env.TAURI_BUILD = originalTauri;
  });
});
