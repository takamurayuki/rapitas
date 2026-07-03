/**
 * Lifecycle test helpers
 *
 * Shared fakes, module-mock factories, and timer patches for the lifecycle.ts
 * test suite, split across lifecycle-setup-worker.test.ts and
 * lifecycle-crash-recovery.test.ts to stay under the 300-line file-size
 * guideline. Not a test file itself — each test file still calls
 * mock.module() directly, since bun's mock hoisting requires the call site
 * to live in the file that later imports the mocked module.
 */
import { mock } from 'bun:test';
import { EventEmitter } from 'events';
import type { WorkerState } from './lifecycle';

export interface FakeChildProcess extends EventEmitter {
  pid?: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  send: ReturnType<typeof mock>;
  kill: ReturnType<typeof mock>;
}

/** Minimal EventEmitter-backed stand-in for a spawned ChildProcess. */
export function createFakeChild(pid: number): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.send = mock(() => true);
  child.kill = mock(() => true);
  return child;
}

export interface WorkerMessageCallbacks {
  onReady: (pid: unknown) => void;
  onShuttingDown: (signal: unknown) => void;
}

/** Fresh, independently-clearable logger stub matching createLogger's return shape. */
export function createLoggerInstance() {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  };
}

/** Fresh worker state matching the shape lifecycle.ts mutates. */
export function createState(): WorkerState {
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
  };
}

/**
 * A minimal re-implementation of event-bridge's worker-ready /
 * worker-shutting-down dispatch, used as the mocked `handleWorkerMessage` so
 * lifecycle.ts's own onReady/onShuttingDown wiring can be exercised without
 * depending on the real event-bridge module.
 */
export function makeHandleWorkerMessageMock() {
  return mock(
    (
      message: Record<string, unknown>,
      _pending: Map<string, unknown>,
      callbacks: WorkerMessageCallbacks,
    ) => {
      const type = message.type as string;
      const data = message.data as Record<string, unknown> | undefined;
      if (type === 'worker-ready') callbacks.onReady(data?.pid);
      if (type === 'worker-shutting-down') callbacks.onShuttingDown(data?.signal);
    },
  );
}

/** Real setTimeout captured before any test patches global.setTimeout. */
const realSetTimeout = global.setTimeout;

/** Resolves on the next real macrotask tick — used to flush fire-and-forget async chains. */
export function flush(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 0));
}

/**
 * Patches setTimeout so every delay fires on the next tick (0ms) instead of
 * the real 30s/5s/2s production delays baked into lifecycle.ts, and patches
 * setInterval/clearInterval to track live handles so tests can assert on and
 * clear them without leaking an active timer past the test run.
 *
 * @returns restore() to undo the patch, plus the set of intervals created while patched
 */
export function installFastTimers(): {
  restore: () => void;
  pendingIntervals: Set<ReturnType<typeof setInterval>>;
} {
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  const pendingIntervals = new Set<ReturnType<typeof setInterval>>();

  (global as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
    fn: (...args: unknown[]) => void,
    _ms?: number,
    ...args: unknown[]
  ) => realSetTimeout(fn, 0, ...args)) as typeof setTimeout;

  (global as unknown as { setInterval: typeof setInterval }).setInterval = ((
    fn: (...args: unknown[]) => void,
    ...rest: unknown[]
  ) => {
    // NOTE: kept alive at a 24h period (never fires during a test) rather than
    // cleared outright, since startHealthCheck's own clearInterval-on-restart
    // branch needs a real, clearable handle to operate on.
    // NOTE: bun-types' Timer and @types/node's Timeout are structurally distinct
    // return types for the ambient setInterval overloads TS picks here — cast
    // through unknown since both are opaque handles accepted back by clearInterval.
    const handle = realSetInterval(
      fn as () => void,
      24 * 60 * 60 * 1000,
      ...rest,
    ) as unknown as ReturnType<typeof setInterval>;
    pendingIntervals.add(handle);
    return handle;
  }) as typeof setInterval;

  (global as unknown as { clearInterval: typeof clearInterval }).clearInterval = ((
    handle: ReturnType<typeof setInterval>,
  ) => {
    pendingIntervals.delete(handle);
    realClearInterval(handle);
  }) as typeof clearInterval;

  return {
    restore: () => {
      global.setTimeout = realSetTimeout;
      global.setInterval = realSetInterval;
      global.clearInterval = realClearInterval;
      for (const handle of pendingIntervals) {
        realClearInterval(handle);
      }
      pendingIntervals.clear();
    },
    pendingIntervals,
  };
}
