/**
 * AgentWorkerManager readiness ガードテスト
 * getActiveExecutionIdsAsync が isWorkerReady=false / isShuttingDown=true のとき
 * IPC を呼ばずに即 [] を返すことをテストする
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { WorkerState } from '../../services/agents/agent-worker/lifecycle';

// public-api を先にモックしてから AgentWorkerManager をロード
const mockGetActiveExecutionIdsAsync = mock(async () => [1, 2, 3]);

mock.module('../../services/agents/agent-worker/public-api', () => ({
  getActiveExecutionIdsAsync: mockGetActiveExecutionIdsAsync,
  // NOTE: 他のエクスポートは型のみのため省略可
}));

const mockLoggerInstance = {
  info: mock(() => {}),
  debug: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

mock.module('../../config/logger', () => ({
  createLogger: () => mockLoggerInstance,
  logger: mockLoggerInstance,
  getBackendLogFilePath: mock(() => '/tmp/test.log'),
}));

mock.module('../../services/agents/agent-worker/worker-shutdown', () => ({
  initializeWorker: mock(async () => {}),
  gracefulShutdown: mock(async () => {}),
}));

const { AgentWorkerManager } = await import('../../services/agents/agent-worker-manager');

/** AgentWorkerManager の private state に型安全にアクセスするためのヘルパー型 */
type ManagerWithPrivateState = {
  state: WorkerState;
};

describe('AgentWorkerManager.getActiveExecutionIdsAsync — readiness ガード', () => {
  let manager: AgentWorkerManager;

  beforeEach(() => {
    manager = AgentWorkerManager.getInstance();
    // シングルトン状態をリセット
    (manager as unknown as ManagerWithPrivateState).state.isWorkerReady = false;
    (manager as unknown as ManagerWithPrivateState).state.isShuttingDown = false;
    mockGetActiveExecutionIdsAsync.mockReset();
    mockGetActiveExecutionIdsAsync.mockReturnValue(Promise.resolve([1, 2, 3]));
  });

  it('isWorkerReady=false: IPC を呼ばず即 [] を返す', async () => {
    (manager as unknown as ManagerWithPrivateState).state.isWorkerReady = false;

    const result = await manager.getActiveExecutionIdsAsync();

    expect(result).toEqual([]);
    expect(mockGetActiveExecutionIdsAsync).not.toHaveBeenCalled();
  });

  it('isShuttingDown=true: IPC を呼ばず即 [] を返す', async () => {
    (manager as unknown as ManagerWithPrivateState).state.isWorkerReady = true;
    (manager as unknown as ManagerWithPrivateState).state.isShuttingDown = true;

    const result = await manager.getActiveExecutionIdsAsync();

    expect(result).toEqual([]);
    expect(mockGetActiveExecutionIdsAsync).not.toHaveBeenCalled();
  });

  it('isWorkerReady=true かつ isShuttingDown=false: IPC（api.getActiveExecutionIdsAsync）を呼ぶ', async () => {
    (manager as unknown as ManagerWithPrivateState).state.isWorkerReady = true;
    (manager as unknown as ManagerWithPrivateState).state.isShuttingDown = false;

    const result = await manager.getActiveExecutionIdsAsync();

    expect(result).toEqual([1, 2, 3]);
    expect(mockGetActiveExecutionIdsAsync).toHaveBeenCalledTimes(1);
  });
});
