/**
 * task-executor ユニットテスト
 *
 * executeTask() の早期シャットダウン guard（line 581-583）を検証する。
 * ctx.isShuttingDown=true のとき、DB・agentFactory への
 * アクセスなしに throw することを確認する。
 */
import { describe, test, expect, mock } from 'bun:test';

// ── Module-level mocks（import 前に宣言） ──────────────────────────────────────

// NOTE: createAgent が呼ばれないことを検証するためスパイを先に定義する
const createAgentMock = mock(() => ({ execute: async () => ({}) }));

mock.module('../agent-factory', () => ({
  agentFactory: {
    createAgent: createAgentMock,
    removeAgent: mock(async () => true),
  },
  AgentFactory: {
    getInstance: () => ({
      createAgent: createAgentMock,
      removeAgent: mock(async () => true),
    }),
  },
}));

mock.module('../../memory', () => ({
  memoryTaskQueue: {
    add: mock(async () => {}),
    process: mock(async () => {}),
  },
}));

mock.module('../../memory/timeline', () => ({
  appendEvent: mock(async () => {}),
}));

mock.module('../../memory/rag/context-builder', () => ({
  buildTaskRAGContext: mock(async () => ''),
}));

mock.module('../../../utils/llm-call-context', () => ({
  withLlmCallScope: mock(async (fn: () => Promise<unknown>) => fn()),
  getLlmCallCount: mock(() => 0),
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

mock.module('./execution-helpers', () => ({
  createLogChunkManager: mock(() => ({ cleanup: () => {} })),
  setupQuestionDetectedHandler: mock(() => {}),
  setupOutputHandler: mock(() => {}),
  saveExecutionResult: mock(async () => {}),
  emitResultEvent: mock(() => {}),
  handleExecutionError: mock(async () => ({
    success: false,
    output: '',
    artifacts: [],
    commits: [],
    executionTimeMs: 0,
    waitingForInput: false,
  })),
}));

mock.module('../execution-file-logger', () => ({
  ExecutionFileLogger: class {
    logError() {}
    logWarn() {}
    logInfo() {}
    async flush() {}
    logExecutionEnd() {}
  },
}));

const createNotification = mock(() => Promise.resolve({})) as any;
mock.module('../../communication/notification-service', () => ({ createNotification }));

// ── 動的 import（全 mock.module 宣言後） ──────────────────────────────────────

const { executeTask, autoCompleteTaskDurable } = await import('./task-executor');

// ── 型 import（ランタイムに影響なし） ─────────────────────────────────────────

import type { OrchestratorContext, ExecutionOptions } from './types';
import type { AgentTask } from '../base-agent';

// ── ヘルパー ──────────────────────────────────────────────────────────────────

/**
 * テスト用の最小 OrchestratorContext を生成する。
 *
 * @param overrides - 上書きするフィールド / 部分的な上書き
 * @returns テスト用 OrchestratorContext
 */
function makeCtx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    prisma: {
      aIAgentConfig: {
        findFirst: mock(async () => null),
        findUnique: mock(async () => null),
      },
      agentExecution: {
        create: mock(async () => ({ id: 1 })),
        update: mock(async () => ({})),
      },
    } as unknown as OrchestratorContext['prisma'],
    activeExecutions: new Map(),
    activeAgents: new Map(),
    isShuttingDown: false,
    serverStartedAt: new Date(),
    emitEvent: () => {},
    startQuestionTimeout: () => {},
    cancelQuestionTimeout: () => {},
    getQuestionTimeoutInfo: () => null,
    tryAcquireContinuationLock: () => true,
    releaseContinuationLock: () => {},
    buildAgentConfigFromDb: mock(async () => ({
      type: 'claude-code' as const,
      name: 'test',
    })),
    ...overrides,
  } as OrchestratorContext;
}

const MINIMAL_TASK: AgentTask = {
  id: 1,
  title: 'テストタスク',
  description: 'テスト用の説明',
};

const MINIMAL_OPTS: ExecutionOptions = {
  taskId: 1,
  sessionId: 1,
};

// ── テスト ────────────────────────────────────────────────────────────────────

describe('executeTask() — 早期シャットダウン guard', () => {
  test('isShuttingDown=true → シャットダウンメッセージで reject する', async () => {
    const ctx = makeCtx({ isShuttingDown: true });

    await expect(executeTask(ctx, MINIMAL_TASK, MINIMAL_OPTS)).rejects.toThrow(
      'Server is shutting down, cannot start new execution',
    );
  });

  test('isShuttingDown=true → agentFactory.createAgent が呼ばれない', async () => {
    createAgentMock.mockClear();
    const ctx = makeCtx({ isShuttingDown: true });

    await expect(executeTask(ctx, MINIMAL_TASK, MINIMAL_OPTS)).rejects.toThrow();

    // NOTE: 早期 guard で throw するため agentFactory.createAgent には到達しない
    expect(createAgentMock).not.toHaveBeenCalled();
  });
});

describe('autoCompleteTaskDurable() — fault injection', () => {
  test('retries once on a transient failure, then succeeds without notifying', async () => {
    createNotification.mockClear();
    const update = mock()
      .mockImplementationOnce(() => Promise.reject(new Error('transient DB error')))
      .mockImplementationOnce(() => Promise.resolve({}));
    const prisma = { task: { update } } as unknown as OrchestratorContext['prisma'];

    await autoCompleteTaskDurable(prisma, 42, 7);

    expect(update).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createNotification).not.toHaveBeenCalled();
  });

  test('notifies instead of silently leaving the task stuck when both attempts fail', async () => {
    createNotification.mockClear();
    const update = mock(() => Promise.reject(new Error('DB down')));
    const prisma = { task: { update } } as unknown as OrchestratorContext['prisma'];

    // Must resolve, never throw — a stuck completion write must not crash the
    // (fire-and-forget) caller.
    await autoCompleteTaskDurable(prisma, 42, 7);

    expect(update).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][0]).toEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ taskId: 42 }) }),
    );
  });
});
