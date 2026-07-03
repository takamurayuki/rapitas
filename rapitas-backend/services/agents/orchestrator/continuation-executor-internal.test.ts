/**
 * continuation-executor ユニットテスト（executeContinuationInternal 系）
 *
 * シャットダウンガード・正常系の保存/イベント発火・resume失敗フォールバック・
 * agentFactory.removeAgent 対象選択の回帰・ALS LLM呼び出しカウント統合・
 * エラーハンドリング・DB設定解決・ログ採番を検証する。
 * 公開ラッパー（executeContinuation/executeContinuationWithLock）の事前チェックは
 * continuation-executor.test.ts 側。
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  executeContinuationInternal,
  removeAgentMock,
  fileLoggerSpies,
  createLogChunkManagerMock,
  saveExecutionResultMock,
  emitResultEventMock,
  handleExecutionErrorMock,
  handleResumeFailureFallbacksMock,
  agentExecuteMock,
  defaultAgentResult,
  makeExecution,
  makePrisma,
  makeCtx,
  resetMocks,
  setAgentExecute,
  setSessionResumeFailure,
  setLlmCallCount,
  type FakeAgent,
} from './continuation-executor.test-helpers';
import type { OrchestratorContext } from './types';

beforeEach(resetMocks);

describe('executeContinuationInternal()', () => {
  test('execution が存在しない → throw する', async () => {
    const prisma = makePrisma({
      agentExecution: { findUnique: async () => null, update: async () => ({}) },
    });
    const ctx = makeCtx({ prisma: prisma as unknown as OrchestratorContext['prisma'] });

    await expect(executeContinuationInternal(ctx, 999, 'response')).rejects.toThrow(
      'Execution not found: 999',
    );
  });

  test('isShuttingDown=true → activeAgents/activeExecutions を後始末してからシャットダウンエラーを投げる', async () => {
    const ctx = makeCtx({ isShuttingDown: true });

    await expect(executeContinuationInternal(ctx, 10, 'response')).rejects.toThrow(
      'Server is shutting down, cannot continue execution',
    );

    expect(ctx.activeAgents.has(10)).toBe(false);
    expect(ctx.activeExecutions.has(10)).toBe(false);
    expect(fileLoggerSpies.logWarn).toHaveBeenCalledWith(
      'Server is shutting down, cannot continue execution',
    );
    expect(fileLoggerSpies.flush).toHaveBeenCalledTimes(1);
    // Guard fires before the agent is ever executed.
    expect(agentExecuteMock).not.toHaveBeenCalled();
  });

  test('正常系: 継続メッセージで running に更新し、agent.execute の結果を保存・イベント発火する', async () => {
    const ctx = makeCtx();

    const result = await executeContinuationInternal(ctx, 10, 'ユーザーの回答');

    const prisma = ctx.prisma as unknown as ReturnType<typeof makePrisma>;
    expect(prisma.agentExecution.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        status: 'running',
        question: null,
        questionType: null,
        questionDetails: null,
      }),
    });

    expect(agentExecuteMock).toHaveBeenCalledTimes(1);
    const agentTask = agentExecuteMock.mock.calls[0][0] as { description: string };
    expect(agentTask.description).toContain('ユーザーの回答');
    expect(agentTask.description).toContain('My Task');

    expect(saveExecutionResultMock).toHaveBeenCalledTimes(1);
    expect(emitResultEventMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);

    // 後始末
    expect(ctx.activeAgents.has(10)).toBe(false);
    expect(ctx.activeExecutions.has(10)).toBe(false);
    expect(removeAgentMock).toHaveBeenCalledWith('agent-1');
  });

  test('resume失敗を検知 → handleResumeFailureFallbacks の結果を最終結果として保存する', async () => {
    setSessionResumeFailure(() => true);
    const ctx = makeCtx();

    const result = await executeContinuationInternal(ctx, 10, 'response');

    expect(handleResumeFailureFallbacksMock).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('fallback-done');
    expect(saveExecutionResultMock).toHaveBeenCalledTimes(1);
    expect(saveExecutionResultMock.mock.calls[0][4]).toMatchObject({ output: 'fallback-done' });
  });

  test('レグレッション回帰: フォールバック成功後は agentInfo.agent（新エージェント）が removeAgent される', async () => {
    // BUG FIX regression: previously the finally block removed the stale
    // original `agent` (already removed once by fallback-handler itself),
    // leaking the actual live post-fallback agent in AgentFactory forever.
    setSessionResumeFailure(() => true);
    handleResumeFailureFallbacksMock.mockImplementation(async (...args: unknown[]) => {
      const agentInfo = args[4] as { agent: FakeAgent };
      agentInfo.agent = { id: 'agent-fallback-final', execute: async () => defaultAgentResult() };
      return {
        success: true,
        output: 'fallback-done',
        artifacts: [],
        commits: [],
        executionTimeMs: 50,
        waitingForInput: false,
      };
    });
    const ctx = makeCtx();

    await executeContinuationInternal(ctx, 10, 'response');

    // The finally block must remove the *current* agentInfo.agent, not the
    // stale original `agent-1` reference.
    expect(removeAgentMock).toHaveBeenCalledWith('agent-fallback-final');
    expect(removeAgentMock).not.toHaveBeenCalledWith('agent-1');
  });

  test('ALSのLLM呼び出しカウントをTier1のllmCallCountへマージする', async () => {
    setLlmCallCount(3);
    setAgentExecute(async () => ({ ...defaultAgentResult(), llmCallCount: 2 }));
    const ctx = makeCtx();

    await executeContinuationInternal(ctx, 10, 'response');

    expect(saveExecutionResultMock.mock.calls[0][4]).toMatchObject({ llmCallCount: 5 });
  });

  test('agent.execute が失敗 → handleExecutionError を呼び、後始末してから再 throw する', async () => {
    setAgentExecute(async () => {
      throw new Error('provider exploded');
    });
    const ctx = makeCtx();

    await expect(executeContinuationInternal(ctx, 10, 'response')).rejects.toThrow(
      'provider exploded',
    );

    expect(handleExecutionErrorMock).toHaveBeenCalledTimes(1);
    const [, executionId, sessionId, taskId, , error, , , context] =
      handleExecutionErrorMock.mock.calls[0];
    expect(executionId).toBe(10);
    expect(sessionId).toBe(20);
    expect(taskId).toBe(30);
    expect((error as Error).message).toBe('provider exploded');
    expect(context).toBe('Continuation');

    // Cleanup still runs on the error path.
    expect(ctx.activeAgents.has(10)).toBe(false);
    expect(ctx.activeExecutions.has(10)).toBe(false);
    expect(removeAgentMock).toHaveBeenCalledWith('agent-1');
  });

  test('agentConfigId が設定されている場合、DB永続化済みconfigを問い合わせる', async () => {
    const prisma = makePrisma({
      agentExecution: {
        findUnique: async () => makeExecution({ agentConfigId: 55 }),
        update: async () => ({}),
      },
      aIAgentConfig: {
        findUnique: mock(async () => ({
          id: 55,
          agentType: 'claude-code',
          name: 'Persisted Agent',
          endpoint: null,
          apiKeyEncrypted: null,
          modelId: 'claude-x',
        })),
      },
    });
    const ctx = makeCtx({ prisma: prisma as unknown as OrchestratorContext['prisma'] });

    await executeContinuationInternal(ctx, 10, 'response');

    expect(prisma.aIAgentConfig.findUnique).toHaveBeenCalledWith({ where: { id: 55 } });
  });

  test('agentConfigId が null の場合、DB永続化済みconfigは問い合わせない', async () => {
    const ctx = makeCtx();

    await executeContinuationInternal(ctx, 10, 'response');

    const prisma = ctx.prisma as unknown as ReturnType<typeof makePrisma>;
    expect(prisma.aIAgentConfig.findUnique).not.toHaveBeenCalled();
  });

  test('既存ログがある場合、次のsequenceNumberから継続する', async () => {
    const prisma = makePrisma({
      agentExecutionLog: { findMany: async () => [{ sequenceNumber: 5 }] },
    });
    const ctx = makeCtx({ prisma: prisma as unknown as OrchestratorContext['prisma'] });

    await executeContinuationInternal(ctx, 10, 'response');

    expect(createLogChunkManagerMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialSequenceNumber: 6 }),
    );
  });

  test('既存ログがない場合、sequenceNumberは0から始まる', async () => {
    const ctx = makeCtx();

    await executeContinuationInternal(ctx, 10, 'response');

    expect(createLogChunkManagerMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialSequenceNumber: 0 }),
    );
  });
});
