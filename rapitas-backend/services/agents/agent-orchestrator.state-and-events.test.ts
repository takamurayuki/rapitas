/**
 * agent-orchestrator.state-and-events.test
 *
 * Covers the read-only execution-state queries, event listener add/remove,
 * and the question-timeout / continuation-lock delegation surface — including
 * an end-to-end timer test proving the constructor wiring between
 * QuestionTimeoutManager's fired timeout and the orchestrator's private
 * handleQuestionTimeout() → continuation-executor's handleQuestionTimeout().
 *
 * QuestionTimeoutManager and EventManager are used for real (not mocked):
 * both are pure, dependency-light collaborators, so exercising them directly
 * gives real coverage of the wiring instead of re-testing mocks.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

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

mock.module('./agent-factory', () => ({
  AGENT_TYPES: ['claude-code', 'codex', 'gemini', 'custom'],
  isAgentType: (s: unknown) => typeof s === 'string',
  narrowAgentType: (s: string | null | undefined) => s ?? 'claude-code',
  AgentFactory: class {
    static getInstance() {
      return {
        createAgent: () => ({ stop: () => Promise.resolve() }),
        getAgent: () => undefined,
        removeAgent: () => Promise.resolve(true),
      };
    }
  },
  agentFactory: {
    createAgent: () => ({ stop: () => Promise.resolve() }),
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

mock.module('./orchestrator/lifecycle-manager', () => ({
  setupSignalHandlers: mock(() => {}),
  gracefulShutdown: mock(() => Promise.resolve()),
  saveAllAgentStates: mock(() => Promise.resolve()),
  saveAgentState: mock(() => Promise.resolve()),
}));

mock.module('./orchestrator/task-executor', () => ({
  executeTask: mock(() => Promise.resolve({ success: true, output: '' })),
  autoCompleteTaskDurable: mock(() => Promise.resolve()),
}));

const handleQuestionTimeoutMock = mock(() => Promise.resolve());
mock.module('./orchestrator/continuation-executor', () => ({
  executeContinuation: mock(() => Promise.resolve({ success: true, output: '' })),
  executeContinuationWithLock: mock(() => Promise.resolve({ success: true, output: '' })),
  executeContinuationInternal: mock(() => Promise.resolve({ success: true, output: '' })),
  handleQuestionTimeout: handleQuestionTimeoutMock,
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

import type { ExecutionState, ActiveAgentInfo, OrchestratorEvent } from './orchestrator/types';
import type { QuestionKey } from './question-detection';

type OrchestratorInternals = {
  activeExecutions: Map<number, ExecutionState>;
  activeAgents: Map<number, ActiveAgentInfo>;
  questionTimeoutManager: { cancelAllTimeouts: () => void };
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

function makeExecutionState(overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    executionId: 1,
    sessionId: 10,
    agentId: 'agent-1',
    taskId: 100,
    status: 'running',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    output: '',
    ...overrides,
  };
}

function makeActiveAgentInfo(overrides: Partial<ActiveAgentInfo> = {}): ActiveAgentInfo {
  const state = makeExecutionState();
  return {
    agent: { stop: () => Promise.resolve() } as unknown as ActiveAgentInfo['agent'],
    executionId: state.executionId,
    sessionId: state.sessionId,
    taskId: state.taskId,
    state,
    lastOutput: '',
    lastSavedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  const orchestrator = getOrchestrator();
  internals(orchestrator).activeExecutions.clear();
  internals(orchestrator).activeAgents.clear();
  internals(orchestrator).questionTimeoutManager.cancelAllTimeouts();
  handleQuestionTimeoutMock.mockClear();
});

describe('execution state queries', () => {
  test('getActiveExecutionCount reflects the activeAgents map size', () => {
    const orchestrator = getOrchestrator();
    internals(orchestrator).activeAgents.set(1, makeActiveAgentInfo());
    internals(orchestrator).activeAgents.set(2, makeActiveAgentInfo({ executionId: 2 }));

    expect(orchestrator.getActiveExecutionCount()).toBe(2);
  });

  test('getActiveAgentInfos projects the public-facing shape', () => {
    const orchestrator = getOrchestrator();
    const info = makeActiveAgentInfo({ lastOutput: 'partial output' });
    internals(orchestrator).activeAgents.set(info.executionId, info);

    const result = orchestrator.getActiveAgentInfos();

    expect(result).toEqual([
      {
        executionId: info.executionId,
        sessionId: info.sessionId,
        taskId: info.taskId,
        startedAt: info.state.startedAt,
        lastOutput: 'partial output',
      },
    ]);
  });

  test('getActiveExecutions returns all tracked executions', () => {
    const orchestrator = getOrchestrator();
    const a = makeExecutionState({ executionId: 1 });
    const b = makeExecutionState({ executionId: 2 });
    internals(orchestrator).activeExecutions.set(1, a);
    internals(orchestrator).activeExecutions.set(2, b);

    expect(orchestrator.getActiveExecutions()).toEqual(expect.arrayContaining([a, b]));
  });

  test('getSessionExecutions filters by sessionId only', () => {
    const orchestrator = getOrchestrator();
    const match = makeExecutionState({ executionId: 1, sessionId: 10 });
    const other = makeExecutionState({ executionId: 2, sessionId: 20 });
    internals(orchestrator).activeExecutions.set(1, match);
    internals(orchestrator).activeExecutions.set(2, other);

    expect(orchestrator.getSessionExecutions(10)).toEqual([match]);
  });

  test('getExecutionState returns undefined for an unknown executionId', () => {
    const orchestrator = getOrchestrator();
    expect(orchestrator.getExecutionState(999)).toBeUndefined();
  });

  test('getExecutionState returns the tracked state for a known executionId', () => {
    const orchestrator = getOrchestrator();
    const state = makeExecutionState({ executionId: 42 });
    internals(orchestrator).activeExecutions.set(42, state);

    expect(orchestrator.getExecutionState(42)).toBe(state);
  });
});

describe('event listener management', () => {
  test('addEventListener receives events emitted through the shared EventManager', () => {
    const orchestrator = getOrchestrator();
    const listener = mock((_event: OrchestratorEvent) => {});
    orchestrator.addEventListener(listener);

    const event: OrchestratorEvent = {
      type: 'execution_started',
      executionId: 1,
      sessionId: 1,
      taskId: 1,
      timestamp: new Date(),
    };
    // Exercised via getContext()'s emitEvent, captured indirectly by
    // reaching the same EventManager instance the orchestrator itself uses.
    (
      orchestrator as unknown as { eventManager: { emitEvent: (e: OrchestratorEvent) => void } }
    ).eventManager.emitEvent(event);

    expect(listener).toHaveBeenCalledWith(event);
    orchestrator.removeEventListener(listener);
  });

  test('removeEventListener stops further delivery', () => {
    const orchestrator = getOrchestrator();
    const listener = mock((_event: OrchestratorEvent) => {});
    orchestrator.addEventListener(listener);
    orchestrator.removeEventListener(listener);

    (
      orchestrator as unknown as { eventManager: { emitEvent: (e: OrchestratorEvent) => void } }
    ).eventManager.emitEvent({
      type: 'execution_completed',
      executionId: 1,
      sessionId: 1,
      taskId: 1,
      timestamp: new Date(),
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('question timeout delegation', () => {
  afterEach(() => {
    internals(getOrchestrator()).questionTimeoutManager.cancelAllTimeouts();
  });

  test('startQuestionTimeout schedules a timeout retrievable via getQuestionTimeoutInfo', () => {
    const orchestrator = getOrchestrator();
    orchestrator.startQuestionTimeout(1, 100);

    const info = orchestrator.getQuestionTimeoutInfo(1);

    expect(info).not.toBeNull();
    expect(info?.remainingSeconds).toBeGreaterThan(0);
  });

  test('cancelQuestionTimeout clears a scheduled timeout', () => {
    const orchestrator = getOrchestrator();
    orchestrator.startQuestionTimeout(1, 100);

    orchestrator.cancelQuestionTimeout(1);

    expect(orchestrator.getQuestionTimeoutInfo(1)).toBeNull();
  });

  test('getQuestionTimeoutInfo returns null for an execution with no active timeout', () => {
    const orchestrator = getOrchestrator();
    expect(orchestrator.getQuestionTimeoutInfo(999)).toBeNull();
  });

  test('tryAcquireContinuationLock rejects a second acquire for the same executionId', () => {
    const orchestrator = getOrchestrator();
    expect(orchestrator.tryAcquireContinuationLock(5, 'user_response')).toBe(true);
    expect(orchestrator.tryAcquireContinuationLock(5, 'auto_timeout')).toBe(false);

    orchestrator.releaseContinuationLock(5);
  });

  test('releaseContinuationLock allows the lock to be re-acquired', () => {
    const orchestrator = getOrchestrator();
    orchestrator.tryAcquireContinuationLock(6, 'user_response');
    orchestrator.releaseContinuationLock(6);

    expect(orchestrator.hasContinuationLock(6)).toBe(false);
    expect(orchestrator.tryAcquireContinuationLock(6, 'auto_timeout')).toBe(true);

    orchestrator.releaseContinuationLock(6);
  });

  test('hasContinuationLock reflects current lock state', () => {
    const orchestrator = getOrchestrator();
    expect(orchestrator.hasContinuationLock(7)).toBe(false);
    orchestrator.tryAcquireContinuationLock(7, 'user_response');
    expect(orchestrator.hasContinuationLock(7)).toBe(true);

    orchestrator.releaseContinuationLock(7);
  });
});

describe('question timeout firing (end-to-end constructor wiring)', () => {
  test('a fired timeout invokes continuation-executor.handleQuestionTimeout via the orchestrator', async () => {
    const orchestrator = getOrchestrator();
    // 0.001s → 1ms: fires almost immediately. `|| DEFAULT` in
    // QuestionTimeoutManager only treats an exact 0 as "unset", so a tiny
    // positive value is required to get a fast, deterministic fire.
    const questionKey: QuestionKey = {
      status: 'awaiting_user_input',
      question_id: 'q1',
      question_type: 'confirmation',
      requires_response: true,
      timeout_seconds: 0.001,
    };

    orchestrator.startQuestionTimeout(55, 200, questionKey);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handleQuestionTimeoutMock).toHaveBeenCalledTimes(1);
    const [, executionId, taskId] = handleQuestionTimeoutMock.mock.calls[0] as unknown as [
      unknown,
      number,
      number,
    ];
    expect(executionId).toBe(55);
    expect(taskId).toBe(200);
  });
});
