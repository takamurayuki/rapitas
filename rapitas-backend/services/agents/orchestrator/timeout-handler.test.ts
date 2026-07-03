/**
 * timeout-handler unit tests
 *
 * Covers handleQuestionTimeout: lock acquisition, stale/invalid execution
 * guards, the auto-continue happy paths (success/failure × waiting-for-input),
 * and the error-recovery path when the continuation itself throws.
 *
 * ./continuation-executor is fully mocked so executeContinuationInternal's
 * heavy transitive dependencies (agent-factory, session-resume-detector,
 * fallback-handler, ...) are never loaded.
 */
import { describe, test, expect, mock } from 'bun:test';

// ── Module-level mocks (before dynamic import) ─────────────────────────────

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  getBackendLogFilePath: () => '/tmp/fake.log',
}));

const executeContinuationInternal = mock(async () => ({ success: true, output: '' }));
mock.module('./continuation-executor', () => ({
  executeContinuationInternal,
  executeContinuation: mock(async () => ({ success: true, output: '' })),
  executeContinuationWithLock: mock(async () => ({ success: true, output: '' })),
  handleQuestionTimeout: mock(async () => {}),
}));

const { handleQuestionTimeout } = await import('./timeout-handler');

import type { OrchestratorContext } from './types';

// ── Helpers ─────────────────────────────────────────────────────────────────

type MockExecution = {
  id: number;
  sessionId: number;
  status: string;
  question: string | null;
  questionDetails: string | null;
  session: { id: number };
};

function makeExecution(overrides: Partial<MockExecution> = {}): MockExecution {
  return {
    id: 1,
    sessionId: 10,
    status: 'waiting_for_input',
    question: '続行しますか？',
    questionDetails: null,
    session: { id: 10 },
    ...overrides,
  };
}

function makeCtx(
  overrides: {
    findUnique?: ReturnType<typeof mock>;
    executionUpdate?: ReturnType<typeof mock>;
    taskUpdate?: ReturnType<typeof mock>;
    sessionUpdate?: ReturnType<typeof mock>;
    tryAcquireContinuationLock?: ReturnType<typeof mock>;
    releaseContinuationLock?: ReturnType<typeof mock>;
    emitEvent?: ReturnType<typeof mock>;
  } = {},
): OrchestratorContext {
  return {
    prisma: {
      agentExecution: {
        findUnique: overrides.findUnique ?? mock(async () => makeExecution()),
        update: overrides.executionUpdate ?? mock(async () => ({})),
      },
      task: { update: overrides.taskUpdate ?? mock(async () => ({})) },
      agentSession: { update: overrides.sessionUpdate ?? mock(async () => ({})) },
    } as unknown as OrchestratorContext['prisma'],
    activeExecutions: new Map(),
    activeAgents: new Map(),
    isShuttingDown: false,
    serverStartedAt: new Date(),
    emitEvent: overrides.emitEvent ?? mock(() => {}),
    startQuestionTimeout: mock(() => {}),
    cancelQuestionTimeout: mock(() => {}),
    getQuestionTimeoutInfo: mock(() => null),
    tryAcquireContinuationLock: overrides.tryAcquireContinuationLock ?? mock(() => true),
    releaseContinuationLock: overrides.releaseContinuationLock ?? mock(() => {}),
    buildAgentConfigFromDb: mock(async () => ({ type: 'claude-code' as const, name: 'test' })),
  } as OrchestratorContext;
}

const generateDefaultResponse = mock(() => '続行してください');

// ── Guards ────────────────────────────────────────────────────────────────

describe('handleQuestionTimeout — guards', () => {
  test('does nothing when the continuation lock is already held', async () => {
    const findUnique = mock(async () => makeExecution());
    const releaseContinuationLock = mock(() => {});
    const ctx = makeCtx({
      findUnique,
      tryAcquireContinuationLock: mock(() => false),
      releaseContinuationLock,
    });

    await handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse);

    expect(findUnique).not.toHaveBeenCalled();
    // NOTE: the lock-held guard returns from the outer try before the
    // inner try/finally is entered, so release must NOT be called either.
    expect(releaseContinuationLock).not.toHaveBeenCalled();
  });

  test('releases the lock and does nothing when the execution no longer exists', async () => {
    const findUnique = mock(async () => null);
    const executionUpdate = mock(async () => ({}));
    const releaseContinuationLock = mock(() => {});
    const ctx = makeCtx({ findUnique, executionUpdate, releaseContinuationLock });

    await handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse);

    expect(executionUpdate).not.toHaveBeenCalled();
    expect(releaseContinuationLock).toHaveBeenCalledTimes(1);
  });

  test('releases the lock and does nothing when the execution is no longer waiting for input', async () => {
    const findUnique = mock(async () => makeExecution({ status: 'running' }));
    const executionUpdate = mock(async () => ({}));
    const releaseContinuationLock = mock(() => {});
    const ctx = makeCtx({ findUnique, executionUpdate, releaseContinuationLock });

    await handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse);

    expect(executionUpdate).not.toHaveBeenCalled();
    expect(releaseContinuationLock).toHaveBeenCalledTimes(1);
  });
});

// ── Happy paths ───────────────────────────────────────────────────────────

describe('handleQuestionTimeout — auto-continue', () => {
  test('marks the execution running, emits a timeout event, and calls the continuation with the default response', async () => {
    executeContinuationInternal.mockClear();
    generateDefaultResponse.mockClear();
    const execution = makeExecution({ question: 'proceed?', questionDetails: '{"options":[]}' });
    const findUnique = mock(async () => execution);
    const executionUpdate = mock(async () => ({}));
    const emitEvent = mock(() => {});
    executeContinuationInternal.mockImplementationOnce(async () => ({ success: true, output: '' }));
    const ctx = makeCtx({ findUnique, executionUpdate, emitEvent });

    await handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse);

    expect(executionUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'running' } });
    expect(generateDefaultResponse).toHaveBeenCalledWith(undefined, 'proceed?', '{"options":[]}');
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent.mock.calls[0][0]).toMatchObject({
      executionId: 1,
      taskId: 100,
      data: expect.objectContaining({ questionTimeoutTriggered: true }),
    });
    expect(executeContinuationInternal).toHaveBeenCalledWith(ctx, 1, '続行してください', {
      timeout: 900000,
    });
  });

  test('on success without a further question, marks the task done and the session completed', async () => {
    executeContinuationInternal.mockImplementationOnce(async () => ({
      success: true,
      waitingForInput: false,
    }));
    const taskUpdate = mock(async () => ({}));
    const sessionUpdate = mock(async () => ({}));
    const ctx = makeCtx({ taskUpdate, sessionUpdate });

    await handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse);

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 100 },
        data: expect.objectContaining({ status: 'done' }),
      }),
    );
    expect(sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  test('on success but a new question is waiting, leaves the task/session untouched', async () => {
    executeContinuationInternal.mockImplementationOnce(async () => ({
      success: true,
      waitingForInput: true,
    }));
    const taskUpdate = mock(async () => ({}));
    const sessionUpdate = mock(async () => ({}));
    const ctx = makeCtx({ taskUpdate, sessionUpdate });

    await handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse);

    expect(taskUpdate).not.toHaveBeenCalled();
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  test('on failure without a further question, reverts the task to todo and marks the session failed', async () => {
    executeContinuationInternal.mockImplementationOnce(async () => ({
      success: false,
      waitingForInput: false,
      errorMessage: 'agent crashed',
    }));
    const taskUpdate = mock(async () => ({}));
    const sessionUpdate = mock(async () => ({}));
    const ctx = makeCtx({ taskUpdate, sessionUpdate });

    await handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse);

    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: 100 }, data: { status: 'todo' } });
    expect(sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', errorMessage: 'agent crashed' }),
      }),
    );
  });

  test('on failure with a missing errorMessage, falls back to a default failure message', async () => {
    executeContinuationInternal.mockImplementationOnce(async () => ({
      success: false,
      waitingForInput: false,
    }));
    const sessionUpdate = mock(async () => ({}));
    const ctx = makeCtx({ sessionUpdate });

    await handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse);

    expect(sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorMessage: 'Execution failed after timeout auto-continue',
        }),
      }),
    );
  });

  test('on failure but a new question is waiting, leaves the task/session untouched', async () => {
    executeContinuationInternal.mockImplementationOnce(async () => ({
      success: false,
      waitingForInput: true,
    }));
    const taskUpdate = mock(async () => ({}));
    const sessionUpdate = mock(async () => ({}));
    const ctx = makeCtx({ taskUpdate, sessionUpdate });

    await handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse);

    expect(taskUpdate).not.toHaveBeenCalled();
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  test('a task/session update failure after a successful continuation is swallowed', async () => {
    executeContinuationInternal.mockImplementationOnce(async () => ({
      success: true,
      waitingForInput: false,
    }));
    const taskUpdate = mock(async () => {
      throw new Error('db down');
    });
    const ctx = makeCtx({ taskUpdate });

    await expect(
      handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse),
    ).resolves.toBeUndefined();
  });
});

// ── Error recovery ────────────────────────────────────────────────────────

describe('handleQuestionTimeout — continuation failure', () => {
  test('reverts the execution to waiting_for_input and releases the lock when the continuation throws', async () => {
    executeContinuationInternal.mockImplementationOnce(async () => {
      throw new Error('continuation crashed');
    });
    const executionUpdate = mock(async () => ({}));
    const releaseContinuationLock = mock(() => {});
    const ctx = makeCtx({ executionUpdate, releaseContinuationLock });

    await expect(
      handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse),
    ).resolves.toBeUndefined();

    expect(executionUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'waiting_for_input' },
    });
    expect(releaseContinuationLock).toHaveBeenCalledTimes(1);
  });

  test('does not throw even if the recovery update itself fails', async () => {
    executeContinuationInternal.mockImplementationOnce(async () => {
      throw new Error('continuation crashed');
    });
    const executionUpdate = mock((args: { data: { status: string } }) => {
      if (args.data.status === 'waiting_for_input')
        return Promise.reject(new Error('db also down'));
      return Promise.resolve({});
    });
    const ctx = makeCtx({ executionUpdate: executionUpdate as unknown as ReturnType<typeof mock> });

    await expect(
      handleQuestionTimeout(ctx, 1, 100, generateDefaultResponse),
    ).resolves.toBeUndefined();
  });
});
