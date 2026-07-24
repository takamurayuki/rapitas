/**
 * continuation-executor テストヘルパー
 *
 * continuation-executor.test.ts と continuation-executor-internal.test.ts が
 * 共有するモジュールモック・スパイ・フィクスチャを一箇所に集約する。
 * mock.module は process 全体に影響するため、対象モジュールを import する前に
 * ここで一度だけ宣言し、両テストファイルはこのヘルパー経由でのみ
 * continuation-executor をロードする。
 */
import { mock } from 'bun:test';
import type { OrchestratorContext } from './types';

// ── Module-level mocks（import 前に宣言） ──────────────────────────────────────

export type FakeAgent = { id: string; execute: (task: unknown) => Promise<unknown> };

/** デフォルトの成功結果（AgentExecutionResult の最小形）。 */
export function defaultAgentResult() {
  return {
    success: true,
    output: 'done',
    artifacts: [],
    commits: [],
    executionTimeMs: 100,
    waitingForInput: false,
  };
}

let agentExecuteImpl: (task: unknown) => Promise<unknown> = async () => defaultAgentResult();
/** 個々のテストから agent.execute() の挙動を差し替えるためのセッター。 */
export function setAgentExecute(impl: (task: unknown) => Promise<unknown>): void {
  agentExecuteImpl = impl;
}
export const agentExecuteMock = mock((task: unknown) => agentExecuteImpl(task));

let nextAgentId = 1;
export const createAgentMock = mock((): FakeAgent => {
  const id = `agent-${nextAgentId++}`;
  return { id, execute: (task: unknown) => agentExecuteMock(task) };
});
export const removeAgentMock = mock(async () => true);

mock.module('../agent-factory', () => ({
  AGENT_TYPES: ['claude-code', 'codex', 'gemini', 'custom'],
  isAgentType: (s: unknown) =>
    typeof s === 'string' && ['claude-code', 'codex', 'gemini', 'custom'].includes(s),
  narrowAgentType: (s: string | null | undefined, fallback = 'claude-code') =>
    typeof s === 'string' && ['claude-code', 'codex', 'gemini', 'custom'].includes(s)
      ? s
      : fallback,
  AgentFactory: {
    getInstance: () => ({ createAgent: createAgentMock, removeAgent: removeAgentMock }),
  },
  agentFactory: { createAgent: createAgentMock, removeAgent: removeAgentMock },
}));

export const fileLoggerSpies = {
  logExecutionStart: mock((..._args: unknown[]) => {}),
  logQuestionAnswered: mock((..._args: unknown[]) => {}),
  logWarn: mock((..._args: unknown[]) => {}),
  logInfo: mock((..._args: unknown[]) => {}),
  logError: mock((..._args: unknown[]) => {}),
  logExecutionEnd: mock((..._args: unknown[]) => {}),
  logStatusChange: mock((..._args: unknown[]) => {}),
  logGitCommit: mock((..._args: unknown[]) => {}),
  flush: mock(async (..._args: unknown[]) => {}),
};
class FakeExecutionFileLogger {
  logExecutionStart(...args: unknown[]) {
    return fileLoggerSpies.logExecutionStart(...args);
  }
  logQuestionAnswered(...args: unknown[]) {
    return fileLoggerSpies.logQuestionAnswered(...args);
  }
  logWarn(...args: unknown[]) {
    return fileLoggerSpies.logWarn(...args);
  }
  logInfo(...args: unknown[]) {
    return fileLoggerSpies.logInfo(...args);
  }
  logError(...args: unknown[]) {
    return fileLoggerSpies.logError(...args);
  }
  logExecutionEnd(...args: unknown[]) {
    return fileLoggerSpies.logExecutionEnd(...args);
  }
  logStatusChange(...args: unknown[]) {
    return fileLoggerSpies.logStatusChange(...args);
  }
  logGitCommit(...args: unknown[]) {
    return fileLoggerSpies.logGitCommit(...args);
  }
  flush(...args: unknown[]) {
    return fileLoggerSpies.flush(...args);
  }
}
mock.module('../execution-file-logger', () => ({
  ExecutionFileLogger: FakeExecutionFileLogger,
  DEFAULT_CONFIG: {},
  listExecutionLogFiles: mock(() => []),
  getExecutionLogFile: mock(() => null),
  cleanupOldLogs: mock(async () => {}),
}));

mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: mock(() => 'C:/tmp/log.txt'),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

export const createLogChunkManagerMock = mock(() => ({ cleanup: mock(async () => {}) }));
export const setupQuestionDetectedHandlerMock = mock(() => {});
export const setupOutputHandlerMock = mock(() => {});
export const saveExecutionResultMock = mock(async () => {});
export const emitResultEventMock = mock(() => {});
export const handleExecutionErrorMock = mock(async () => {});
export const determineExecutionStatusMock = mock(() => 'completed');
export const extractIdeaMarkersMock = mock(() => []);
mock.module('./execution-helpers', () => ({
  toJsonString: (v: unknown) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v)),
  createLogChunkManager: createLogChunkManagerMock,
  setupQuestionDetectedHandler: setupQuestionDetectedHandlerMock,
  setupOutputHandler: setupOutputHandlerMock,
  determineExecutionStatus: determineExecutionStatusMock,
  saveExecutionResult: saveExecutionResultMock,
  emitResultEvent: emitResultEventMock,
  handleExecutionError: handleExecutionErrorMock,
  extractIdeaMarkers: extractIdeaMarkersMock,
}));

let isSessionResumeFailureImpl: (result: unknown, sessionId: unknown) => boolean = () => false;
/** 個々のテストから isSessionResumeFailure() の判定結果を差し替えるためのセッター。 */
export function setSessionResumeFailure(
  impl: (result: unknown, sessionId: unknown) => boolean,
): void {
  isSessionResumeFailureImpl = impl;
}
mock.module('../session-resume-detector', () => ({
  SESSION_FAILURE_RE: /session/i,
  isSessionResumeFailure: (result: unknown, sessionId: unknown) =>
    isSessionResumeFailureImpl(result, sessionId),
}));

export const handleResumeFailureFallbacksMock = mock(async (..._args: unknown[]) => ({
  success: true,
  output: 'fallback-done',
  artifacts: [],
  commits: [],
  executionTimeMs: 50,
  waitingForInput: false,
}));
mock.module('./fallback-handler', () => ({
  handleResumeFailureFallbacks: (...args: unknown[]) => handleResumeFailureFallbacksMock(...args),
}));

let llmCallCountValue = 0;
/** ALS 経由の LLM 呼び出しカウントをテストから設定するためのセッター。 */
export function setLlmCallCount(n: number): void {
  llmCallCountValue = n;
}
export const withLlmCallScopeMock = mock(async (fn: () => Promise<unknown>) => fn());
export const getLlmCallCountMock = mock(() => llmCallCountValue);
export const incrementLlmCallMock = mock(() => {});
mock.module('../../../utils/llm-call-context', () => ({
  withLlmCallScope: withLlmCallScopeMock,
  incrementLlmCall: incrementLlmCallMock,
  getLlmCallCount: getLlmCallCountMock,
}));

// ── 動的 import（全 mock.module 宣言後） ──────────────────────────────────────

export const { executeContinuation, executeContinuationWithLock, executeContinuationInternal } =
  await import('./continuation-executor');

// ── フィクスチャ ──────────────────────────────────────────────────────────────

/** テスト用の AgentExecution + ネストされた session/config/task レコードを構築する。 */
export function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    sessionId: 20,
    status: 'waiting_for_input',
    claudeSessionId: 'sess-abc',
    agentConfigId: null,
    output: 'previous output',
    artifacts: null,
    tokensUsed: 0,
    executionTimeMs: 0,
    session: {
      id: 20,
      config: {
        taskId: 30,
        task: { title: 'My Task', description: 'desc', workingDirectory: '/work' },
      },
    },
    ...overrides,
  };
}

/** テスト用の Prisma スタブを構築する。findUnique は毎回 execution を返す。 */
export function makePrisma(overrides: Record<string, unknown> = {}) {
  const execution = makeExecution();
  return {
    agentExecution: {
      findUnique: mock(async () => execution),
      update: mock(async () => ({})),
    },
    aIAgentConfig: {
      findUnique: mock(async () => null),
    },
    agentExecutionLog: {
      findMany: mock(async () => []),
    },
    // applyTaskStatusFromWorkflow (post-continuation epilogue) reads/writes
    // this — default workflowStatus:'completed' so it resolves to a harmless
    // status:'done' write for tests that don't care about task status.
    task: {
      findUnique: mock(async () => ({ workflowStatus: 'completed' })),
      update: mock(async () => ({})),
    },
    ...overrides,
  };
}

/** テスト用の最小 OrchestratorContext を生成する。 */
export function makeCtx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    prisma: makePrisma() as unknown as OrchestratorContext['prisma'],
    activeExecutions: new Map(),
    activeAgents: new Map(),
    isShuttingDown: false,
    serverStartedAt: new Date(),
    emitEvent: mock(() => {}),
    startQuestionTimeout: mock(() => {}),
    cancelQuestionTimeout: mock(() => {}),
    getQuestionTimeoutInfo: mock(() => null),
    tryAcquireContinuationLock: mock(() => true),
    releaseContinuationLock: mock(() => {}),
    buildAgentConfigFromDb: mock(async () => ({ type: 'claude-code' as const, name: 'test' })),
    ...overrides,
  } as OrchestratorContext;
}

/** 各テストの前に全スパイ・可変フィクスチャを初期状態へ戻す。 */
export function resetMocks(): void {
  setAgentExecute(async () => defaultAgentResult());
  nextAgentId = 1;
  agentExecuteMock.mockClear();
  createAgentMock.mockClear();
  removeAgentMock.mockClear();
  Object.values(fileLoggerSpies).forEach((m) => m.mockClear());
  createLogChunkManagerMock.mockClear();
  setupQuestionDetectedHandlerMock.mockClear();
  setupOutputHandlerMock.mockClear();
  saveExecutionResultMock.mockClear();
  emitResultEventMock.mockClear();
  handleExecutionErrorMock.mockClear();
  determineExecutionStatusMock.mockClear();
  extractIdeaMarkersMock.mockClear();
  setSessionResumeFailure(() => false);
  handleResumeFailureFallbacksMock.mockClear();
  handleResumeFailureFallbacksMock.mockImplementation(async () => ({
    success: true,
    output: 'fallback-done',
    artifacts: [],
    commits: [],
    executionTimeMs: 50,
    waitingForInput: false,
  }));
  setLlmCallCount(0);
  withLlmCallScopeMock.mockClear();
  getLlmCallCountMock.mockClear();
  incrementLlmCallMock.mockClear();
}
