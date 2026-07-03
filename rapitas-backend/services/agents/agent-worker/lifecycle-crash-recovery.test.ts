/**
 * Tests for agent-worker lifecycle: handleWorkerCrash and startHealthCheck
 *
 * Covers the crash-recovery guards/restart chain and the periodic health-check
 * timer's threshold-based crash trigger. See lifecycle-setup-worker.test.ts for
 * setupWorker's own spawn/ready/timeout coverage (split to stay under the
 * 300-line file-size guideline).
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  createFakeChild,
  createLoggerInstance,
  createState,
  flush,
  installFastTimers,
  makeHandleWorkerMessageMock,
} from './lifecycle-test-helpers';
import type { WorkerState } from './lifecycle';

let spawnBehavior: 'ready' | 'silent' = 'ready';
let nextPid = 2000;

const spawnMock = mock((_cmd: string, _args: string[], _opts: Record<string, unknown>) => {
  const child = createFakeChild(++nextPid);
  if (spawnBehavior === 'ready') {
    queueMicrotask(() => child.emit('message', { type: 'worker-ready', data: { pid: child.pid } }));
  }
  return child;
});

const registerProcessMock = mock(() => {});
const unregisterProcessMock = mock(() => {});
const loggerInstance = createLoggerInstance();
const sendIPCRequestMock = mock(() => Promise.resolve({ activeExecutionCount: 0 }));
const rejectAllPendingRequestsMock = mock(() => {});
const handleWorkerMessageMock = makeHandleWorkerMessageMock();

mock.module('child_process', () => ({
  spawn: spawnMock,
  exec: mock(() => {}),
  execFile: mock(() => {}),
  execSync: mock(() => Buffer.from('')),
  execFileSync: mock(() => Buffer.from('')),
  fork: mock(() => {}),
  spawnSync: mock(() => {}),
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => loggerInstance,
  logger: loggerInstance,
  getBackendLogFilePath: () => '/tmp/fake.log',
}));

mock.module('../agent-process-tracker', () => ({
  registerProcess: registerProcessMock,
  unregisterProcess: unregisterProcessMock,
  cleanupZombieProcesses: mock(() => 0),
  killProcessTreeSafely: mock(() => false),
  clearAllPidFiles: mock(() => {}),
}));

mock.module('./ipc', () => ({
  sendIPCRequest: sendIPCRequestMock,
  rejectAllPendingRequests: rejectAllPendingRequestsMock,
  handleIPCResponse: mock(() => {}),
}));

mock.module('./event-bridge', () => ({
  handleWorkerMessage: handleWorkerMessageMock,
  handleOrchestratorEvent: mock(() => {}),
}));

const { handleWorkerCrash, startHealthCheck } = await import('./lifecycle');

let timers: ReturnType<typeof installFastTimers>;

beforeEach(() => {
  spawnBehavior = 'ready';
  spawnMock.mockClear();
  rejectAllPendingRequestsMock.mockClear();
  sendIPCRequestMock.mockClear();
  sendIPCRequestMock.mockImplementation(() => Promise.resolve({ activeExecutionCount: 0 }));
  loggerInstance.info.mockClear();
  loggerInstance.warn.mockClear();
  loggerInstance.error.mockClear();
  loggerInstance.debug.mockClear();
  timers = installFastTimers();
});

afterEach(() => {
  timers.restore();
});

describe('handleWorkerCrash', () => {
  test('is a no-op while already shutting down', async () => {
    const state = createState();
    state.isShuttingDown = true;

    await handleWorkerCrash(state);

    expect(rejectAllPendingRequestsMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('is a no-op when a restart is already in flight', async () => {
    const state = createState();
    state.restartPromise = new Promise(() => {});

    await handleWorkerCrash(state);

    expect(rejectAllPendingRequestsMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('rejects pending requests and restarts the worker on success', async () => {
    const state = createState();

    await handleWorkerCrash(state);

    expect(rejectAllPendingRequestsMock).toHaveBeenCalledWith(
      state.pendingRequests,
      expect.any(Error),
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(state.restartPromise).toBeNull();
    expect(state.isWorkerReady).toBe(true);
  });

  test('clears a pre-existing health-check interval before restarting', async () => {
    const state = createState();
    state.healthCheckInterval = setInterval(() => {}, 24 * 60 * 60 * 1000);
    const staleHandle = state.healthCheckInterval;

    await handleWorkerCrash(state);

    expect(timers.pendingIntervals.has(staleHandle)).toBe(false);
    expect(state.healthCheckInterval).not.toBeNull();
    expect(state.healthCheckInterval).not.toBe(staleHandle);
  });

  test('schedules a further crash-recovery attempt when the restart itself fails, then stops on shutdown', async () => {
    spawnBehavior = 'silent';
    const state = createState();

    await handleWorkerCrash(state);

    // restartWorker caught the setupWorker timeout and scheduled a retry via
    // setTimeout; flag shutdown before that (fast, macrotask) retry fires so
    // it self-cancels instead of looping forever against the silent spawn.
    state.isShuttingDown = true;
    await flush();
    await flush();

    expect(loggerInstance.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Failed to restart worker'),
    );
    expect(state.restartPromise).toBeNull();
  });
});

describe('startHealthCheck', () => {
  function captureInterval(): { getCallback: () => (() => void | Promise<void>) | null } {
    let callback: (() => void | Promise<void>) | null = null;
    (global as unknown as { setInterval: typeof setInterval }).setInterval = ((
      fn: () => void | Promise<void>,
    ) => {
      callback = fn;
      return 999 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    return { getCallback: () => callback };
  }

  test('replaces an existing interval instead of stacking a second one', () => {
    const state = createState();
    const clearIntervalCalls: unknown[] = [];
    (global as unknown as { clearInterval: typeof clearInterval }).clearInterval = ((
      handle: unknown,
    ) => {
      clearIntervalCalls.push(handle);
    }) as typeof clearInterval;
    state.healthCheckInterval = 'existing-handle' as unknown as ReturnType<typeof setInterval>;

    startHealthCheck(state);

    expect(clearIntervalCalls).toContain('existing-handle');
  });

  test('skips the IPC ping while shutting down or not yet ready', async () => {
    const state = createState();
    state.isShuttingDown = true;
    state.isWorkerReady = true;
    const { getCallback } = captureInterval();

    startHealthCheck(state);
    await getCallback()?.();

    expect(sendIPCRequestMock).not.toHaveBeenCalled();
  });

  test('caches the active execution count on a successful ping', async () => {
    const state = createState();
    state.isWorkerReady = true;
    state.workerProcess = createFakeChild(1) as unknown as WorkerState['workerProcess'];
    sendIPCRequestMock.mockImplementation(() => Promise.resolve({ activeExecutionCount: 7 }));
    const { getCallback } = captureInterval();

    startHealthCheck(state);
    await getCallback()?.();

    expect(state.cachedActiveCount).toBe(7);
  });

  test('does not restart the worker on an isolated failure below the threshold', async () => {
    const state = createState();
    state.isWorkerReady = true;
    state.workerProcess = createFakeChild(1) as unknown as WorkerState['workerProcess'];
    sendIPCRequestMock.mockImplementation(() => Promise.reject(new Error('timeout')));
    const { getCallback } = captureInterval();

    startHealthCheck(state);
    await getCallback()?.();
    await getCallback()?.();

    expect(rejectAllPendingRequestsMock).not.toHaveBeenCalled();
  });

  test('triggers crash recovery once consecutive failures reach the threshold', async () => {
    const state = createState();
    state.isWorkerReady = true;
    state.workerProcess = createFakeChild(1) as unknown as WorkerState['workerProcess'];
    sendIPCRequestMock.mockImplementation(() => Promise.reject(new Error('timeout')));
    const { getCallback } = captureInterval();

    startHealthCheck(state);
    await getCallback()?.();
    await getCallback()?.();
    await getCallback()?.();
    await flush();

    expect(rejectAllPendingRequestsMock).toHaveBeenCalledWith(
      state.pendingRequests,
      expect.any(Error),
    );
  });
});
