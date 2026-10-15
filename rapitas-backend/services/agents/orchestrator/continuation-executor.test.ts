/**
 * continuation-executor ユニットテスト（公開ラッパー系）
 *
 * executeContinuation / executeContinuationWithLock の事前チェック（ロック取得・
 * ステータス検証）とロック解放を検証する。executeContinuationInternal の詳細な
 * 実行フローは continuation-executor-internal.test.ts 側で検証する。
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  executeContinuation,
  executeContinuationWithLock,
  createAgentMock,
  saveExecutionResultMock,
  handleExecutionErrorMock,
  makeExecution,
  makePrisma,
  makeCtx,
  resetMocks,
  setAgentExecute,
} from './continuation-executor.test-helpers';
import type { OrchestratorContext } from './types';

beforeEach(resetMocks);

// ── executeContinuation() ─────────────────────────────────────────────────────

describe('executeContinuation()', () => {
  test('ロック取得失敗 → DBに触れず「既に処理中」を返す', async () => {
    const prisma = makePrisma();
    const ctx = makeCtx({
      prisma: prisma as unknown as OrchestratorContext['prisma'],
      tryAcquireContinuationLock: () => false,
    });

    const result = await executeContinuation(ctx, 10, 'response');

    expect(result).toEqual({
      success: false,
      output: '',
      errorMessage: 'This execution is already being processed',
    });
    expect(prisma.agentExecution.findUnique).not.toHaveBeenCalled();
    expect(ctx.releaseContinuationLock).not.toHaveBeenCalled();
  });

  test('execution が存在しない → throw し、ロックは解放される', async () => {
    const prisma = makePrisma({
      agentExecution: {
        findUnique: async () => null,
        update: async () => ({}),
      },
    });
    const ctx = makeCtx({ prisma: prisma as unknown as OrchestratorContext['prisma'] });

    await expect(executeContinuation(ctx, 999, 'response')).rejects.toThrow(
      'Execution not found: 999',
    );
    expect(ctx.releaseContinuationLock).toHaveBeenCalledWith(999);
  });

  test('status=running → 「既に実行中」を返し、内部実行には進まない', async () => {
    const prisma = makePrisma({
      agentExecution: {
        findUnique: async () => makeExecution({ status: 'running' }),
        update: async () => ({}),
      },
    });
    const ctx = makeCtx({ prisma: prisma as unknown as OrchestratorContext['prisma'] });

    const result = await executeContinuation(ctx, 10, 'response');

    expect(result).toEqual({
      success: false,
      output: '',
      errorMessage: 'Execution is already running',
    });
    expect(ctx.cancelQuestionTimeout).not.toHaveBeenCalled();
    expect(ctx.releaseContinuationLock).toHaveBeenCalledWith(10);
    expect(createAgentMock).not.toHaveBeenCalled();
  });

  test('status が waiting_for_input 以外（例: completed） → ステータスを含むエラーを返す', async () => {
    const prisma = makePrisma({
      agentExecution: {
        findUnique: async () => makeExecution({ status: 'completed' }),
        update: async () => ({}),
      },
    });
    const ctx = makeCtx({ prisma: prisma as unknown as OrchestratorContext['prisma'] });

    const result = await executeContinuation(ctx, 10, 'response');

    expect(result).toEqual({
      success: false,
      output: '',
      errorMessage: 'Execution is not waiting for input: completed',
    });
    expect(createAgentMock).not.toHaveBeenCalled();
  });

  test('status=waiting_for_input → タイムアウトをキャンセルし内部実行へ進み、最後にロックを解放する', async () => {
    const ctx = makeCtx();

    const result = await executeContinuation(ctx, 10, 'response');

    expect(ctx.cancelQuestionTimeout).toHaveBeenCalledWith(10);
    expect(createAgentMock).toHaveBeenCalledTimes(1);
    expect(saveExecutionResultMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(ctx.releaseContinuationLock).toHaveBeenCalledWith(10);
  });

  test('内部実行が throw しても、ロックは解放される', async () => {
    setAgentExecute(async () => {
      throw new Error('agent crashed');
    });
    const ctx = makeCtx();

    await expect(executeContinuation(ctx, 10, 'response')).rejects.toThrow('agent crashed');
    expect(ctx.releaseContinuationLock).toHaveBeenCalledWith(10);
    expect(handleExecutionErrorMock).toHaveBeenCalledTimes(1);
  });
});

// ── executeContinuationWithLock() ────────────────────────────────────────────

describe('executeContinuationWithLock()', () => {
  test('成功時、内部実行の完了後にロックを解放する', async () => {
    const ctx = makeCtx();

    const result = await executeContinuationWithLock(ctx, 10, 'response');

    expect(result.success).toBe(true);
    expect(ctx.releaseContinuationLock).toHaveBeenCalledWith(10);
    // NOTE: このパスは事前チェックを行わないため findUnique は internal 内の1回のみ
    expect(
      (ctx.prisma as unknown as ReturnType<typeof makePrisma>).agentExecution.findUnique,
    ).toHaveBeenCalledTimes(1);
  });

  test('内部実行が throw してもロックは解放される（finally 経由）', async () => {
    setAgentExecute(async () => {
      throw new Error('boom');
    });
    const ctx = makeCtx();

    await expect(executeContinuationWithLock(ctx, 10, 'response')).rejects.toThrow('boom');
    expect(ctx.releaseContinuationLock).toHaveBeenCalledWith(10);
  });
});
