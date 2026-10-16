/**
 * Tests for agent-worker worker-shutdown
 *
 * Covers gracefulShutdown's idempotency guard, health-check teardown, IPC
 * shutdown-notify success/failure branches, SIGTERM/SIGKILL escalation, the
 * kill-throws error path, and initializeWorker's zombie-cleanup + stale-worktree
 * cleanup sequencing.
 *
 * Note: sendIPCRequest/rejectAllPendingRequests from ./ipc are used for real
 * (not mocked) — mocking './ipc' here would be process-global and break
 * ipc.test.ts, which imports the same module path to test the real implementation.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { ChildProcess } from 'child_process';
import type { WorkerState } from './lifecycle';
import type { PendingRequest } from './ipc';

const mockLoggerInfo = mock(() => {});
const mockLoggerWarn = mock(() => {});
const mockLoggerError = mock(() => {});

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: () => {},
  }),
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError, debug: () => {} },
  getBackendLogFilePath: () => 'C:/tmp/backend.log',
}));

const mockCleanupZombieProcesses = mock(() => 0);
mock.module('../agent-process-tracker', () => ({
  registerProcess: () => {},
  unregisterProcess: () => {},
  cleanupZombieProcesses: mockCleanupZombieProcesses,
  killProcessTreeSafely: () => true,
  clearAllPidFiles: () => {},
}));

const mockSetupWorker = mock(() => Promise.resolve());
mock.module('./lifecycle', () => ({
  setupWorker: mockSetupWorker,
  handleWorkerCrash: () => Promise.resolve(),
  startHealthCheck: () => {},
}));

const { gracefulShutdown, initializeWorker } = await import('./worker-shutdown');

/**
 * Build a fake ChildProcess. By default the 'exit' listener fires on the next
 * microtask after registration (simulating a worker that exits promptly), so
 * gracefulShutdown's internal 5s escalation timer never has to actually elapse.
 * Pass autoExit=false to simulate a hung worker for the SIGKILL-escalation test.
 */
function createFakeProcess(autoExit = true) {
  const proc = {
    killed: false,
    kill: mock((_signal: string) => {
      proc.killed = true;
    }),
    on: mock((event: string, cb: () => void) => {
      if (event === 'exit' && autoExit) {
        queueMicrotask(cb);
      }
      return proc;
    }),
  };
  return proc as unknown as ChildProcess & { killed: boolean };
}

function createState(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    workerProcess: null,
    isWorkerReady: false,
    isShuttingDown: false,
    healthCheckInterval: null,
    restartPromise: null,
    requestIdCounter: 0,
    readyResolve: null,
    pendingRequests: new Map(),
    cachedActiveCount: 0,
    ...overrides,
  };
}

describe('gracefulShutdown', () => {
  beforeEach(() => {
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
  });

  it('既に isShuttingDown なら即座に戻り何も行わないこと', async () => {
    const reject = mock(() => {});
    const state = createState({
      isShuttingDown: true,
      pendingRequests: new Map([
        [
          'a',
          {
            resolve: mock(() => {}),
            reject,
            timeout: setTimeout(() => {}, 100000),
            type: 't',
          } as PendingRequest,
        ],
      ]),
    });

    await gracefulShutdown(state);

    expect(reject).not.toHaveBeenCalled();
    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('workerProcess が無い場合でも保留リクエストを reject し isShuttingDown を立てること', async () => {
    const reject = mock(() => {});
    const state = createState({
      pendingRequests: new Map([
        [
          'a',
          {
            resolve: mock(() => {}),
            reject,
            timeout: setTimeout(() => {}, 100000),
            type: 't',
          } as PendingRequest,
        ],
      ]),
    });

    await gracefulShutdown(state);

    expect(state.isShuttingDown).toBe(true);
    expect(reject).toHaveBeenCalledTimes(1);
    expect(state.workerProcess).toBeNull();
  });

  it('healthCheckInterval をクリアして null にすること', async () => {
    const interval = setInterval(() => {}, 999999);
    const state = createState({ healthCheckInterval: interval });

    await gracefulShutdown(state);

    expect(state.healthCheckInterval).toBeNull();
  });

  it('isWorkerReady かつ IPC通知が成功する場合: SIGTERMで終了しworkerProcessをnullにすること', async () => {
    const proc = createFakeProcess(true);
    const pendingRequests = new Map<string, PendingRequest>();
    // sendIPCRequest is the real implementation; resolve its pending entry via
    // process.send, mirroring how the real worker would ack the shutdown request.
    (proc as unknown as { send: (r: { id: string }) => void }).send = mock(
      (request: { id: string }) => {
        const pending = pendingRequests.get(request.id);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(request.id);
          pending.resolve({ ok: true });
        }
      },
    );

    const state = createState({ workerProcess: proc, isWorkerReady: true, pendingRequests });

    await gracefulShutdown(state);

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      expect.anything(),
      '[AgentWorkerManager] Shutdown request to worker failed',
    );
    expect(state.workerProcess).toBeNull();
  });

  it('IPC通知が失敗しても shutdown処理は継続しwarnログを出すこと', async () => {
    const proc = createFakeProcess(true);
    const pendingRequests = new Map<string, PendingRequest>();
    (proc as unknown as { send: (r: { id: string }) => void }).send = mock(
      (request: { id: string }) => {
        const pending = pendingRequests.get(request.id);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(request.id);
          pending.reject(new Error('worker unreachable'));
        }
      },
    );

    const state = createState({ workerProcess: proc, isWorkerReady: true, pendingRequests });

    await gracefulShutdown(state);

    expect(mockLoggerWarn).toHaveBeenCalled();
    expect(state.workerProcess).toBeNull();
  });

  it('既に killed=true のプロセスには kill を呼ばないこと', async () => {
    const proc = createFakeProcess(true);
    (proc as unknown as { killed: boolean }).killed = true;
    const state = createState({ workerProcess: proc, isWorkerReady: false });

    await gracefulShutdown(state);

    expect(proc.kill).not.toHaveBeenCalled();
    expect(state.workerProcess).toBeNull();
  });

  it('kill が例外を投げても error ログに落ちて処理が完了すること', async () => {
    const proc = createFakeProcess(true);
    (proc as unknown as { kill: () => void }).kill = mock(() => {
      throw new Error('kill failed');
    });
    const state = createState({ workerProcess: proc, isWorkerReady: false });

    await gracefulShutdown(state);

    expect(mockLoggerError).toHaveBeenCalled();
    expect(state.workerProcess).toBeNull();
  });

  it('workerが5秒以内に終了しなければ強制的にSIGKILLへ昇格すること', async () => {
    const realSetTimeout = global.setTimeout;
    // NOTE: gracefulShutdown's 5s escalation timer is not injectable, so we
    // shrink every real setTimeout call to fire on the next tick instead of
    // waiting out the real 5000ms — the 'exit' event is deliberately never
    // fired by this fake process, so only the escalation timer resolves it.
    global.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, 0, ...args)) as typeof setTimeout;

    try {
      const proc = createFakeProcess(false);
      const state = createState({ workerProcess: proc, isWorkerReady: false });

      await gracefulShutdown(state);

      expect(proc.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
      expect(proc.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        '[AgentWorkerManager] Force killing worker process',
      );
    } finally {
      global.setTimeout = realSetTimeout;
    }
  });
});

describe('initializeWorker', () => {
  beforeEach(() => {
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockCleanupZombieProcesses.mockClear();
    mockSetupWorker.mockClear();
  });

  it('zombie掃除→setupWorker→stale worktree掃除の順で呼びcleanedCount>0ならinfoログを出すこと', async () => {
    const state = createState();
    const cleanupFn = mock(() => Promise.resolve(3));

    await initializeWorker(state, cleanupFn, '/repo/root');

    expect(mockCleanupZombieProcesses).toHaveBeenCalledTimes(1);
    expect(mockSetupWorker).toHaveBeenCalledWith(state);
    expect(cleanupFn).toHaveBeenCalledWith('/repo/root');
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[AgentWorkerManager] Cleaned up 3 stale worktrees on startup',
    );
  });

  it('cleanedCountが0ならinfoログを出さないこと', async () => {
    const state = createState();
    const cleanupFn = mock(() => Promise.resolve(0));

    await initializeWorker(state, cleanupFn, '/repo/root');

    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('stale worktree掃除が失敗してもwarnログに落ちて例外を投げないこと', async () => {
    const state = createState();
    const cleanupFn = mock(() => Promise.reject(new Error('cleanup failed')));

    await expect(initializeWorker(state, cleanupFn, '/repo/root')).resolves.toBeUndefined();
    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  it('setupWorkerが失敗した場合は例外を伝播しstale worktree掃除を呼ばないこと', async () => {
    mockSetupWorker.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const state = createState();
    const cleanupFn = mock(() => Promise.resolve(0));

    await expect(initializeWorker(state, cleanupFn, '/repo/root')).rejects.toThrow('boom');
    expect(cleanupFn).not.toHaveBeenCalled();
  });
});
