/**
 * Tests for agent-worker lifecycle: setupWorker
 *
 * Covers spawn wiring, readiness, the startup timeout, stdio logging, and the
 * error/exit-driven crash-recovery restart. `child_process`, the logger, the
 * process tracker, the IPC layer, and the event bridge are all mocked — no
 * real subprocess or timer delay is ever used. See lifecycle-crash-recovery.test.ts
 * for handleWorkerCrash / startHealthCheck coverage (split to stay under the
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
  type FakeChildProcess,
} from './lifecycle-test-helpers';

let spawnBehavior: 'ready' | 'silent' = 'ready';
let lastSpawnedChild: FakeChildProcess | null = null;
let nextPid = 1000;

const spawnMock = mock((_cmd: string, _args: string[], _opts: Record<string, unknown>) => {
  const child = createFakeChild(++nextPid);
  lastSpawnedChild = child;
  if (spawnBehavior === 'ready') {
    // Emitted as a microtask so it always wins the race against the (patched,
    // macrotask-based) startup-timeout promise inside setupWorker.
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

const { setupWorker } = await import('./lifecycle');

let timers: ReturnType<typeof installFastTimers>;

beforeEach(() => {
  spawnBehavior = 'ready';
  lastSpawnedChild = null;
  spawnMock.mockClear();
  registerProcessMock.mockClear();
  unregisterProcessMock.mockClear();
  rejectAllPendingRequestsMock.mockClear();
  loggerInstance.info.mockClear();
  loggerInstance.warn.mockClear();
  loggerInstance.error.mockClear();
  loggerInstance.debug.mockClear();
  timers = installFastTimers();
});

afterEach(() => {
  timers.restore();
});

describe('setupWorker', () => {
  test('no-ops when the manager is already shutting down', async () => {
    const state = createState();
    state.isShuttingDown = true;

    await setupWorker(state);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(state.workerProcess).toBeNull();
  });

  test('spawns bun with the worker script and waits for readiness', async () => {
    const state = createState();

    await setupWorker(state);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(cmd).toBe('bun');
    expect(args[0]).toContain('agent-worker.ts');
    expect(opts.windowsHide).toBe(true);
    expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe', 'ipc']);

    expect(state.isWorkerReady).toBe(true);
    expect(state.workerProcess).toBe(lastSpawnedChild);
    expect(registerProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'worker', pid: lastSpawnedChild?.pid }),
    );
    expect(state.healthCheckInterval).not.toBeNull();
  });

  test('rejects with a startup timeout error when the worker never signals ready', async () => {
    spawnBehavior = 'silent';
    const state = createState();

    await expect(setupWorker(state)).rejects.toThrow('Worker startup timeout');
    expect(loggerInstance.error).toHaveBeenCalled();
  });

  test('logs stdout and stderr lines from the worker', async () => {
    const state = createState();
    await setupWorker(state);

    lastSpawnedChild?.stdout.emit('data', Buffer.from('hello from worker'));
    lastSpawnedChild?.stderr.emit('data', Buffer.from('warn from worker'));

    expect(loggerInstance.debug).toHaveBeenCalledWith(expect.stringContaining('hello from worker'));
    expect(loggerInstance.warn).toHaveBeenCalledWith(expect.stringContaining('warn from worker'));
  });

  test('ignores blank stdout/stderr chunks', async () => {
    const state = createState();
    await setupWorker(state);
    loggerInstance.debug.mockClear();
    loggerInstance.warn.mockClear();

    lastSpawnedChild?.stdout.emit('data', Buffer.from('   \n  '));
    lastSpawnedChild?.stderr.emit('data', Buffer.from('   \n  '));

    expect(loggerInstance.debug).not.toHaveBeenCalled();
    expect(loggerInstance.warn).not.toHaveBeenCalled();
  });

  test('an error event triggers crash recovery and restarts the worker', async () => {
    const state = createState();
    await setupWorker(state);
    const firstChild = lastSpawnedChild;

    firstChild?.emit('error', new Error('boom'));
    await flush();
    await flush();

    expect(rejectAllPendingRequestsMock).toHaveBeenCalledWith(
      state.pendingRequests,
      expect.any(Error),
    );
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(state.workerProcess).toBe(lastSpawnedChild);
    expect(state.workerProcess).not.toBe(firstChild);
    expect(state.isWorkerReady).toBe(true);
  });

  test('an unexpected exit triggers crash recovery and unregisters the old pid', async () => {
    const state = createState();
    await setupWorker(state);
    const firstChild = lastSpawnedChild;
    const firstPid = firstChild?.pid;

    firstChild?.emit('exit', 1, null);
    await flush();
    await flush();

    expect(unregisterProcessMock).toHaveBeenCalledWith(firstPid);
    expect(state.isWorkerReady).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  test('exit during a deliberate shutdown does not trigger a restart', async () => {
    const state = createState();
    await setupWorker(state);
    const firstChild = lastSpawnedChild;
    state.isShuttingDown = true;

    firstChild?.emit('exit', 0, null);
    await flush();

    expect(unregisterProcessMock).toHaveBeenCalledWith(firstChild?.pid);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
