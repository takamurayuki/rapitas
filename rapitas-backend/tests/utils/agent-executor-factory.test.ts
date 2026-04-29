/**
 * Agent Executor Factory テスト
 * シングルトンパターンの管理テスト
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';

class MockParallelExecutor {
  constructor(public prisma: unknown) {}
}

mock.module('../../services/parallel-execution/parallel-executor', () => ({
  ParallelExecutor: MockParallelExecutor,
}));

// Note: Do not mock @prisma/client globally as it affects other test files.
// The tests only need a mock prisma object passed as a parameter.

const { getParallelExecutor, cleanupParallelExecutor, isParallelExecutorActive } =
  await import('../../utils/agent/agent-executor-factory');

type MockPrismaClient = Record<string, unknown>;

describe('Agent Executor Factory', () => {
  beforeEach(() => {
    cleanupParallelExecutor();
  });

  test('初期状態ではアクティブでないこと', () => {
    expect(isParallelExecutorActive()).toBe(false);
  });

  test('getParallelExecutorでインスタンスを作成できること', () => {
    const mockPrisma = {} as MockPrismaClient;
    const executor = getParallelExecutor(mockPrisma);
    expect(executor).toBeDefined();
    expect(isParallelExecutorActive()).toBe(true);
  });

  test('同じインスタンスを返すこと（シングルトン）', () => {
    const mockPrisma = {} as MockPrismaClient;
    const executor1 = getParallelExecutor(mockPrisma);
    const executor2 = getParallelExecutor(mockPrisma);
    expect(executor1).toBe(executor2);
  });

  test('cleanupでインスタンスを破棄できること', () => {
    const mockPrisma = {} as MockPrismaClient;
    getParallelExecutor(mockPrisma);
    expect(isParallelExecutorActive()).toBe(true);
    cleanupParallelExecutor();
    expect(isParallelExecutorActive()).toBe(false);
  });

  test('cleanup後に新しいインスタンスを作成できること', () => {
    const mockPrisma = {} as MockPrismaClient;
    const executor1 = getParallelExecutor(mockPrisma);
    cleanupParallelExecutor();
    const executor2 = getParallelExecutor(mockPrisma);
    expect(executor2).toBeDefined();
    expect(executor1).not.toBe(executor2);
  });

  test('インスタンスがない状態でcleanupしてもエラーにならないこと', () => {
    cleanupParallelExecutor(); // should not throw
    expect(isParallelExecutorActive()).toBe(false);
  });
});
