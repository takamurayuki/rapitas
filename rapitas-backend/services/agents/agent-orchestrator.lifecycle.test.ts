/**
 * agent-orchestrator.lifecycle.test
 *
 * Covers AgentOrchestrator's singleton wiring and shutdown-latch state
 * machine: getInstance identity, constructor wiring of signal handlers,
 * gracefulShutdown de-duplication, and the self-healing stale-latch logic
 * in isEffectivelyShuttingDown() (private, exercised via cast — this is
 * the exact mechanism documented as fixing the "Server is shutting down"
 * endless-spin bug, see MEMORY topic shutdown-latch-wedge).
 *
 * All heavy sub-modules (git operations, task/continuation execution,
 * recovery, lifecycle persistence) are mocked; this file only exercises
 * the facade's own state machine.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Module-level mocks (declared before the dynamic import) ────────────────

mock.module('../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  getBackendLogFilePath: (stamp?: string) => `/mock/backend-${stamp ?? 'today'}.log`,
}));

mock.module('../../utils/common/secret-store', () => ({
  isKeychainSecretRef: () => false,
  saveProviderApiKey: () => '',
  saveAgentApiKey: () => '',
  saveSecret: () => '',
  resolveStoredSecret: () => null,
  deleteStoredSecret: () => {},
  maskStoredSecret: () => null,
}));

const createAgentMock = mock(() => ({ stop: mock(() => Promise.resolve()) }));
mock.module('./agent-factory', () => ({
  AGENT_TYPES: ['claude-code', 'codex', 'gemini', 'custom'],
  isAgentType: (s: unknown) => typeof s === 'string',
  narrowAgentType: (s: string | null | undefined) => s ?? 'claude-code',
  AgentFactory: class {
    static getInstance() {
      return {
        createAgent: createAgentMock,
        getAgent: () => undefined,
        removeAgent: () => Promise.resolve(true),
      };
    }
  },
  agentFactory: {
    createAgent: createAgentMock,
    getAgent: () => undefined,
    removeAgent: () => Promise.resolve(true),
    getAllActiveAgents: () => new Map(),
    getRegisteredAgents: () => [],
    getAvailableAgents: () => Promise.resolve([]),
    getAgentsByCapability: () => [],
    createDefaultAgent: () => ({ stop: () => Promise.resolve() }),
  },
}));

mock.module('./orchestrator/git-operations', () => ({
  GitOperations: class {
    getGitDiff = mock(() => Promise.resolve(''));
    getFullGitDiff = mock(() => Promise.resolve(''));
    commitChanges = mock(() => Promise.resolve({ success: true }));
    createPullRequest = mock(() => Promise.resolve({ success: true }));
    mergePullRequest = mock(() => Promise.resolve({ success: true }));
    revertChanges = mock(() => Promise.resolve(true));
    createBranch = mock(() => Promise.resolve(true));
    createWorktree = mock(() => Promise.resolve(''));
    removeWorktree = mock(() => Promise.resolve());
    cleanupStaleWorktrees = mock(() => Promise.resolve(0));
    createCommit = mock(() =>
      Promise.resolve({ hash: '', branch: '', filesChanged: 0, additions: 0, deletions: 0 }),
    );
    getDiff = mock(() => Promise.resolve([]));
  },
  getGitDiff: mock(() => Promise.resolve('')),
  getFullGitDiff: mock(() => Promise.resolve('')),
  commitChanges: mock(() => Promise.resolve({ success: true })),
  getDiff: mock(() => Promise.resolve([])),
  createCommit: mock(() =>
    Promise.resolve({ hash: '', branch: '', filesChanged: 0, additions: 0, deletions: 0 }),
  ),
  createBranch: mock(() => Promise.resolve(true)),
  createPullRequest: mock(() => Promise.resolve({ success: true })),
  mergePullRequest: mock(() => Promise.resolve({ success: true })),
  revertChanges: mock(() => Promise.resolve(true)),
  ensureGitRepository: mock(() => Promise.resolve()),
  validateAndSetupRemote: mock(() => Promise.resolve()),
  createWorktree: mock(() => Promise.resolve('')),
  removeWorktree: mock(() => Promise.resolve()),
  cleanupStaleWorktrees: mock(() => Promise.resolve(0)),
}));

type SetShuttingDownFn = (value: boolean) => void;
type LifecycleCtxLike = { setIsShuttingDown: SetShuttingDownFn };

const setupSignalHandlersMock = mock(
  (_shutdownFn: () => Promise<void>, _saveFn: () => Promise<void>) => {},
);
const gracefulShutdownMock = mock(
  (ctx: LifecycleCtxLike, _options?: { skipServerStop?: boolean }) => {
    ctx.setIsShuttingDown(true);
    return Promise.resolve();
  },
);
const saveAllAgentStatesMock = mock(() => Promise.resolve());

mock.module('./orchestrator/lifecycle-manager', () => ({
  setupSignalHandlers: setupSignalHandlersMock,
  gracefulShutdown: gracefulShutdownMock,
  saveAllAgentStates: saveAllAgentStatesMock,
  saveAgentState: mock(() => Promise.resolve()),
}));

mock.module('./orchestrator/task-executor', () => ({
  executeTask: mock(() => Promise.resolve({ success: true, output: '' })),
  autoCompleteTaskDurable: mock(() => Promise.resolve()),
}));

mock.module('./orchestrator/continuation-executor', () => ({
  executeContinuation: mock(() => Promise.resolve({ success: true, output: '' })),
  executeContinuationWithLock: mock(() => Promise.resolve({ success: true, output: '' })),
  executeContinuationInternal: mock(() => Promise.resolve({ success: true, output: '' })),
  handleQuestionTimeout: mock(() => Promise.resolve()),
}));

mock.module('./orchestrator/recovery-manager', () => ({
  getInterruptedExecutions: mock(() => Promise.resolve([])),
  recoverStaleExecutions: mock(() => Promise.resolve({ recovered: 0, failed: 0 })),
  resumeInterruptedExecution: mock(() => Promise.resolve({ success: true, output: '' })),
  buildResumePrompt: mock(() => ''),
  // NOTE: added in f996dff5 (execution lease) — stale mocks without this export
  // fail ESM named-import validation before any test runs (task 600).
  startExecutionLeaseSweep: mock(() => undefined),
}));

const { AgentOrchestrator } = await import('./agent-orchestrator');

// ── Types for narrow, targeted private-field access ─────────────────────────
// NOTE: These fields have no public setter; the stale-latch self-heal test
// (isEffectivelyShuttingDown) requires forcing _shuttingDownSince into the
// past, which can only be done by reaching past the class's public surface.

type OrchestratorInternals = {
  _isShuttingDown: boolean;
  _shuttingDownSince: number | null;
  shutdownPromise: Promise<void> | null;
  isEffectivelyShuttingDown: () => boolean;
};

function internals(o: InstanceType<typeof AgentOrchestrator>): OrchestratorInternals {
  return o as unknown as OrchestratorInternals;
}

const mockPrisma = {
  agentExecution: { update: mock(() => Promise.resolve({})) },
  userSettings: { findFirst: mock(() => Promise.resolve(null)) },
};

function getOrchestrator() {
  return AgentOrchestrator.getInstance(
    mockPrisma as unknown as Parameters<typeof AgentOrchestrator.getInstance>[0],
  );
}

beforeEach(() => {
  const state = internals(getOrchestrator());
  state._isShuttingDown = false;
  state._shuttingDownSince = null;
  state.shutdownPromise = null;
  gracefulShutdownMock.mockClear();
});

describe('AgentOrchestrator.getInstance', () => {
  test('returns the same instance across repeated calls', () => {
    const first = getOrchestrator();
    const second = getOrchestrator();
    expect(first).toBe(second);
  });

  test('registers signal handlers exactly once, no matter how many times getInstance is called', () => {
    // NOTE: setupSignalHandlersMock is intentionally never cleared above —
    // the singleton (and therefore its constructor) only ever runs once for
    // this whole file's isolated module registry, so the call count must
    // stay pinned at 1 regardless of how many prior tests called getOrchestrator().
    getOrchestrator();
    getOrchestrator();
    expect(setupSignalHandlersMock).toHaveBeenCalledTimes(1);
  });
});

describe('gracefulShutdown', () => {
  test('delegates to lifecycle-manager and flips the shutdown latch', async () => {
    const orchestrator = getOrchestrator();
    expect(orchestrator.isInShutdown()).toBe(false);

    await orchestrator.gracefulShutdown();

    expect(gracefulShutdownMock).toHaveBeenCalledTimes(1);
    expect(orchestrator.isInShutdown()).toBe(true);
  });

  test('a second concurrent call reuses the in-flight shutdown without re-invoking lifecycle-manager', () => {
    const orchestrator = getOrchestrator();

    // NOTE: gracefulShutdown() is declared `async`, so its PUBLIC return
    // value is always a fresh wrapper promise per call (async-function
    // semantics) even when it resolves the same underlying value — so
    // identity is asserted on the internal `shutdownPromise` field instead,
    // which is what the dedup guard actually reuses.
    orchestrator.gracefulShutdown();
    const promiseAfterFirstCall = internals(orchestrator).shutdownPromise;

    orchestrator.gracefulShutdown();
    const promiseAfterSecondCall = internals(orchestrator).shutdownPromise;

    // setIsShuttingDown(true) runs synchronously inside the mock, so by the
    // time the second call is made the facade's own dedup guard is already
    // tripped — doGracefulShutdown must not run twice.
    expect(gracefulShutdownMock).toHaveBeenCalledTimes(1);
    expect(promiseAfterSecondCall).toBe(promiseAfterFirstCall);
  });

  test('passes through options (e.g. skipServerStop) to lifecycle-manager', async () => {
    const orchestrator = getOrchestrator();

    await orchestrator.gracefulShutdown({ skipServerStop: true });

    expect(gracefulShutdownMock).toHaveBeenCalledWith(expect.anything(), { skipServerStop: true });
  });
});

describe('isEffectivelyShuttingDown (stale-latch self-heal)', () => {
  test('reports false when never shutting down', () => {
    const orchestrator = getOrchestrator();
    expect(internals(orchestrator).isEffectivelyShuttingDown()).toBe(false);
  });

  test('reports true for a recent shutdown latch (within the 90s grace budget)', () => {
    const orchestrator = getOrchestrator();
    const state = internals(orchestrator);
    state._isShuttingDown = true;
    state._shuttingDownSince = Date.now();

    expect(state.isEffectivelyShuttingDown()).toBe(true);
    expect(orchestrator.isInShutdown()).toBe(true);
  });

  test('self-heals and clears the latch once past the 90s grace budget', () => {
    const orchestrator = getOrchestrator();
    const state = internals(orchestrator);
    state._isShuttingDown = true;
    state._shuttingDownSince = Date.now() - 91_000;

    expect(state.isEffectivelyShuttingDown()).toBe(false);
    // The latch itself must be cleared, not just the return value — this is
    // what lets subsequent executions resume without a restart.
    expect(orchestrator.isInShutdown()).toBe(false);
    expect(state.shutdownPromise).toBeNull();
  });
});

describe('server stop callback', () => {
  test('stopServer invokes the registered callback', async () => {
    const orchestrator = getOrchestrator();
    const callback = mock(() => Promise.resolve());
    orchestrator.setServerStopCallback(callback);

    await orchestrator.stopServer();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('stopServer swallows a callback error instead of throwing', async () => {
    const orchestrator = getOrchestrator();
    orchestrator.setServerStopCallback(() => {
      throw new Error('listener close failed');
    });

    await expect(orchestrator.stopServer()).resolves.toBeUndefined();
  });
});
