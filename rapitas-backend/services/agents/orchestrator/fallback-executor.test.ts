/**
 * fallback-executor テスト
 *
 * 未分類エラー(no_candidate)時のLLM診断呼び出し(task 612)が
 * fire-and-forget であり、executeWithFallbackAgent のreturnを
 * ブロックしないことを検証する。診断側に人為的な遅延Promiseを仕込み、
 * 関数呼び出しからのreturnがその解決を待たずに完了することを確認する。
 * NOTE: mock.module はプロセスグローバル。
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { FallbackContext } from './fallback-executor';
import type { AgentConfigInput } from '../agent-factory';

mock.module('../agent-factory', () => ({
  agentFactory: { createAgent: mock(() => ({})), removeAgent: mock(async () => {}) },
}));
mock.module('./execution-helpers', () => ({
  setupQuestionDetectedHandler: mock(() => {}),
  setupOutputHandler: mock(() => {}),
}));

const findFallbackAgentConfigMock = mock(async () => null as unknown);
const agentTypeToProviderMock = mock((_type: string) => 'openai' as string | undefined);
mock.module('../../ai/agent-fallback', () => ({
  findFallbackAgentConfig: findFallbackAgentConfigMock,
  agentTypeToProvider: agentTypeToProviderMock,
}));

const classifyAgentErrorMock = mock((_blob: string, _hint?: unknown) => null as unknown);
mock.module('../../ai/agent-error-classifier', () => ({
  classifyAgentError: classifyAgentErrorMock,
}));

const recordRecoveryAttemptMock = mock(() => {});
mock.module('../../ai/recovery-metrics', () => ({
  recordRecoveryAttempt: recordRecoveryAttemptMock,
}));

let diagnosisResolved = false;
const diagnoseErrorWithLlmMock = mock(
  () =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        diagnosisResolved = true;
        resolve();
      }, 200);
    }),
);
mock.module('../../ai/error-diagnosis', () => ({
  diagnoseErrorWithLlm: diagnoseErrorWithLlmMock,
}));

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

const { executeWithFallbackAgent } = await import('./fallback-executor');

const FALLBACK_CTX = { options: { taskId: 612 } } as unknown as FallbackContext;
const ORIGINAL_AGENT_CONFIG = {
  type: 'claude-code',
  name: 'primary',
  modelId: 'sonnet',
} as unknown as AgentConfigInput;

describe('executeWithFallbackAgent — no_candidate診断のfire-and-forget', () => {
  beforeEach(() => {
    diagnosisResolved = false;
    findFallbackAgentConfigMock.mockClear();
    findFallbackAgentConfigMock.mockImplementation(async () => null);
    classifyAgentErrorMock.mockClear();
    classifyAgentErrorMock.mockImplementation(() => null);
    recordRecoveryAttemptMock.mockClear();
    diagnoseErrorWithLlmMock.mockClear();
  });

  test('LLM診断呼び出しが遅延していても no_candidate の応答をブロックしない', async () => {
    const result = await executeWithFallbackAgent(
      FALLBACK_CTX,
      'some unclassified provider error',
      ORIGINAL_AGENT_CONFIG,
    );

    expect(result.fallbackSucceeded).toBe(false);
    // The diagnosis promise takes 200ms — if it had been awaited, this
    // assertion would run after `diagnosisResolved` flips to true.
    expect(diagnosisResolved).toBe(false);
  });

  test('errorBlobが空文字ならLLM診断を呼び出さない', async () => {
    await executeWithFallbackAgent(FALLBACK_CTX, '', ORIGINAL_AGENT_CONFIG);

    expect(diagnoseErrorWithLlmMock).not.toHaveBeenCalled();
  });

  test('classifyAgentErrorが分類できた場合はLLM診断を呼び出さない', async () => {
    classifyAgentErrorMock.mockImplementation(() => ({
      reason: 'rate_limit',
      provider: 'openai',
      retryWithFallback: true,
      rawMessage: 'rate limited',
    }));

    await executeWithFallbackAgent(FALLBACK_CTX, 'rate limited error', ORIGINAL_AGENT_CONFIG);

    expect(diagnoseErrorWithLlmMock).not.toHaveBeenCalled();
  });
});
