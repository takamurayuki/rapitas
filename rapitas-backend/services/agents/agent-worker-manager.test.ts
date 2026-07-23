/**
 * agent-worker-manager.test.ts
 *
 * Verifies AgentWorkerManager's own logic: the singleton accessor, the private
 * ipc()/generateRequestId() plumbing, direct IPC delegation, delegation to the
 * agent-worker/* sub-modules (public-api, git-api, worker-shutdown), the
 * readiness guard on getActiveExecutionIdsAsync, and the orchestrator-compatible
 * sync stub methods. All sub-modules are mocked — this file does not exercise
 * their internal logic (covered by their own colocated tests).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { ChildProcess } from 'child_process';
import type { AgentTask, AgentExecutionResult } from './base-agent';
import type { ExecutionOptions } from './orchestrator/types';
import type { PendingRequest } from './agent-worker/ipc';
import type { WorkerState } from './agent-worker/lifecycle';

const mockLoggerInstance = {
  info: mock(() => {}),
  debug: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

// Mirrors ALL real exports of config/logger.ts — mock.module is process-global,
// so a partial mock would break any other module loaded later in this run.
mock.module('../../config/logger', () => ({
  logger: mockLoggerInstance,
  createLogger: () => mockLoggerInstance,
  getBackendLogFilePath: mock(() => '/tmp/test-backend.log'),
}));

// Mirrors ALL real exports of config/index.ts (see database.ts / db-provider.ts).
mock.module('../../config', () => ({
  prisma: {},
  ensureDatabaseConnection: mock(async () => {}),
  logger: mockLoggerInstance,
  createLogger: () => mockLoggerInstance,
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => ({}),
  getProjectRoot: mock(() => '/fake/project/root'),
}));

const sendIPCRequestMock = mock(
  async (
    _workerProcess: ChildProcess | null,
    _isWorkerReady: boolean,
    _pendingRequests: Map<string, PendingRequest>,
    _generateId: () => string,
    _type: string,
    _data: Record<string, unknown>,
    _timeoutMs?: number,
  ): Promise<unknown> => undefined,
);

// Mirrors ALL real exports of agent-worker/ipc.ts.
mock.module('./agent-worker/ipc', () => ({
  sendIPCRequest: sendIPCRequestMock,
  handleIPCResponse: mock(() => {}),
  rejectAllPendingRequests: mock(() => {}),
}));

const initializeWorkerMock = mock(async () => {});
const gracefulShutdownMock = mock(async () => {});

// Mirrors ALL real exports of agent-worker/worker-shutdown.ts.
mock.module('./agent-worker/worker-shutdown', () => ({
  initializeWorker: initializeWorkerMock,
  gracefulShutdown: gracefulShutdownMock,
}));

const mockExecuteTask = mock(
  async (): Promise<AgentExecutionResult> => ({
    success: true,
    output: '',
  }),
);
const mockExecuteContinuation = mock(
  async (): Promise<AgentExecutionResult> => ({
    success: true,
    output: '',
  }),
);
const mockExecuteContinuationWithLock = mock(
  async (): Promise<AgentExecutionResult> => ({
    success: true,
    output: '',
  }),
);
const mockResumeInterruptedExecution = mock(
  async (): Promise<AgentExecutionResult> => ({
    success: true,
    output: '',
  }),
);
const mockGetSessionExecutionsAsync = mock(async () => [] as unknown[]);
const mockGetQuestionTimeoutInfoAsync = mock(async () => null);
const mockGetActiveExecutionIdsAsync = mock(async () => [] as number[]);

// Mirrors ALL real exports of agent-worker/public-api.ts.
mock.module('./agent-worker/public-api', () => ({
  executeTask: mockExecuteTask,
  executeContinuation: mockExecuteContinuation,
  executeContinuationWithLock: mockExecuteContinuationWithLock,
  resumeInterruptedExecution: mockResumeInterruptedExecution,
  getSessionExecutionsAsync: mockGetSessionExecutionsAsync,
  getQuestionTimeoutInfoAsync: mockGetQuestionTimeoutInfoAsync,
  getActiveExecutionIdsAsync: mockGetActiveExecutionIdsAsync,
}));

const mockCreateBranch = mock(async () => true);
const mockCreateWorktree = mock(async () => '/tmp/worktree');
const mockRemoveWorktree = mock(async () => {});
const mockCleanupStaleWorktrees = mock(async () => 0);
const mockCreateCommit = mock(async () => ({
  hash: 'h',
  branch: 'b',
  filesChanged: 0,
  additions: 0,
  deletions: 0,
}));
const mockCreatePullRequest = mock(async () => ({ success: true }));
const mockMergePullRequest = mock(async () => ({ success: true }));
const mockGetGitDiff = mock(async () => '');
const mockGetFullGitDiff = mock(async () => '');
const mockGetDiff = mock(async () => [] as unknown[]);
const mockRevertChanges = mock(async () => true);
const mockCommitChanges = mock(async () => ({ success: true }));

// Mirrors ALL real exports of agent-worker/git-api.ts.
mock.module('./agent-worker/git-api', () => ({
  createBranch: mockCreateBranch,
  createWorktree: mockCreateWorktree,
  removeWorktree: mockRemoveWorktree,
  cleanupStaleWorktrees: mockCleanupStaleWorktrees,
  createCommit: mockCreateCommit,
  createPullRequest: mockCreatePullRequest,
  mergePullRequest: mockMergePullRequest,
  getGitDiff: mockGetGitDiff,
  getFullGitDiff: mockGetFullGitDiff,
  getDiff: mockGetDiff,
  revertChanges: mockRevertChanges,
  commitChanges: mockCommitChanges,
}));

const { AgentWorkerManager } = await import('./agent-worker-manager');

/** Type-safe accessor for the manager's private mutable state, for test setup only. */
type ManagerWithPrivateState = { state: WorkerState };

/** Type-safe accessor for the manager's private ipc() method, for default-param coverage. */
type ManagerWithPrivateIpc = {
  ipc: (type: string, data: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
};

function freshState(): WorkerState {
  return {
    workerProcess: null,
    pendingRequests: new Map<string, PendingRequest>(),
    isWorkerReady: false,
    isShuttingDown: false,
    healthCheckInterval: null,
    restartPromise: null,
    requestIdCounter: 0,
    readyResolve: null,
    cachedActiveCount: 0,
  };
}

describe('AgentWorkerManager', () => {
  let manager: InstanceType<typeof AgentWorkerManager>;

  beforeEach(() => {
    manager = AgentWorkerManager.getInstance();
    (manager as unknown as ManagerWithPrivateState).state = freshState();

    sendIPCRequestMock.mockClear();
    sendIPCRequestMock.mockImplementation(async () => undefined);
    initializeWorkerMock.mockClear();
    gracefulShutdownMock.mockClear();
    mockExecuteTask.mockClear();
    mockExecuteContinuation.mockClear();
    mockExecuteContinuationWithLock.mockClear();
    mockResumeInterruptedExecution.mockClear();
    mockGetSessionExecutionsAsync.mockClear();
    mockGetQuestionTimeoutInfoAsync.mockClear();
    mockGetActiveExecutionIdsAsync.mockClear();
    mockGetActiveExecutionIdsAsync.mockImplementation(async () => []);
    mockCreateBranch.mockClear();
    mockCreateWorktree.mockClear();
    mockRemoveWorktree.mockClear();
    mockCleanupStaleWorktrees.mockClear();
    mockCreateCommit.mockClear();
    mockCreatePullRequest.mockClear();
    mockMergePullRequest.mockClear();
    mockGetGitDiff.mockClear();
    mockGetFullGitDiff.mockClear();
    mockGetDiff.mockClear();
    mockRevertChanges.mockClear();
    mockCommitChanges.mockClear();
    mockLoggerInstance.error.mockClear();
  });

  describe('getInstance', () => {
    it('常に同一のシングルトンインスタンスを返す', () => {
      const a = AgentWorkerManager.getInstance();
      const b = AgentWorkerManager.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('initialize', () => {
    it('worker-shutdown.initializeWorker に state / cleanup関数 / projectRoot を渡す', async () => {
      await manager.initialize();

      expect(initializeWorkerMock).toHaveBeenCalledTimes(1);
      const [passedState, cleanupFn, projectRoot] = initializeWorkerMock.mock.calls[0];
      expect(passedState).toBe((manager as unknown as ManagerWithPrivateState).state);
      expect(projectRoot).toBe('/fake/project/root');
      expect(typeof cleanupFn).toBe('function');
    });

    it('渡された cleanup 関数は cleanupStaleWorktrees 経由で git.cleanupStaleWorktrees に委譲する', async () => {
      await manager.initialize();

      const cleanupFn = initializeWorkerMock.mock.calls[0][1] as (
        baseDir: string,
      ) => Promise<number>;
      mockCleanupStaleWorktrees.mockResolvedValueOnce(3);

      const result = await cleanupFn('/some/base/dir');

      expect(result).toBe(3);
      expect(mockCleanupStaleWorktrees).toHaveBeenCalledWith(
        expect.any(Function),
        '/some/base/dir',
      );
    });
  });

  describe('private ipc() plumbing', () => {
    it('generateRequestId は呼び出しごとにカウンタをインクリメントした一意なIDを生成する', async () => {
      await manager.stopExecution(1);

      const generateId = sendIPCRequestMock.mock.calls[0][3];
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).toMatch(/^req_\d+_\d+$/);
      expect(id2).toMatch(/^req_\d+_\d+$/);
      expect(id1).not.toBe(id2);
      const counter1 = Number(id1.split('_')[2]);
      const counter2 = Number(id2.split('_')[2]);
      expect(counter2).toBe(counter1 + 1);
    });

    it('timeoutMs 省略時は既定値 60000 を使う', async () => {
      await (manager as unknown as ManagerWithPrivateIpc).ipc('probe-type', { foo: 1 });

      expect(sendIPCRequestMock).toHaveBeenCalledWith(
        null,
        false,
        expect.any(Map),
        expect.any(Function),
        'probe-type',
        { foo: 1 },
        60000,
      );
    });

    it('現在の workerProcess / isWorkerReady / pendingRequests を sendIPCRequest に渡す', async () => {
      const state = (manager as unknown as ManagerWithPrivateState).state;
      state.isWorkerReady = true;

      await manager.stopExecution(42);

      const [workerProcess, isWorkerReady, pendingRequests] = sendIPCRequestMock.mock.calls[0];
      expect(workerProcess).toBe(state.workerProcess);
      expect(isWorkerReady).toBe(true);
      expect(pendingRequests).toBe(state.pendingRequests);
    });
  });

  describe('直接 IPC に委譲するメソッド', () => {
    it('stopExecution は stop-execution / 10000ms で IPC する', async () => {
      sendIPCRequestMock.mockResolvedValueOnce(true);
      const result = await manager.stopExecution(7);
      expect(result).toBe(true);
      expect(sendIPCRequestMock).toHaveBeenCalledWith(
        null,
        false,
        expect.any(Map),
        expect.any(Function),
        'stop-execution',
        { executionId: 7 },
        10000,
      );
    });

    it('getActiveExecutionCountAsync は get-active-count で IPC しキャッシュを更新する', async () => {
      sendIPCRequestMock.mockResolvedValueOnce(9);

      const result = await manager.getActiveExecutionCountAsync();

      expect(result).toBe(9);
      expect(manager.getActiveExecutionCount()).toBe(9);
      expect(sendIPCRequestMock).toHaveBeenCalledWith(
        null,
        false,
        expect.any(Map),
        expect.any(Function),
        'get-active-count',
        {},
        5000,
      );
    });

    it('getActiveExecutionCount は非同期取得なしにキャッシュ済みの値を同期で返す', () => {
      expect(manager.getActiveExecutionCount()).toBe(0);
    });

    it('tryAcquireContinuationLockAsync は try-acquire-lock で IPC する', async () => {
      sendIPCRequestMock.mockResolvedValueOnce(false);
      const result = await manager.tryAcquireContinuationLockAsync(3, 'auto_timeout');
      expect(result).toBe(false);
      expect(sendIPCRequestMock).toHaveBeenCalledWith(
        null,
        false,
        expect.any(Map),
        expect.any(Function),
        'try-acquire-lock',
        { executionId: 3, source: 'auto_timeout' },
        5000,
      );
    });

    it('recoverStaleExecutions は recover-stale / 30000ms で IPC する', async () => {
      const payload = {
        recoveredExecutions: 1,
        updatedTasks: 2,
        updatedSessions: 3,
        interruptedExecutionIds: [9],
        reconciledBlockedSessions: 0,
        prunedWorktreePointers: 0,
      };
      sendIPCRequestMock.mockResolvedValueOnce(payload);

      const result = await manager.recoverStaleExecutions();

      expect(result).toEqual(payload);
      expect(sendIPCRequestMock).toHaveBeenCalledWith(
        null,
        false,
        expect.any(Map),
        expect.any(Function),
        'recover-stale',
        {},
        30000,
      );
    });
  });

  describe('cancelQuestionTimeout', () => {
    it('成功時は例外を投げず error ログも出さない', () => {
      sendIPCRequestMock.mockResolvedValueOnce(undefined);
      expect(() => manager.cancelQuestionTimeout(5)).not.toThrow();
    });

    it('IPC が失敗しても例外を投げず error ログに記録する', async () => {
      sendIPCRequestMock.mockRejectedValueOnce(new Error('boom'));

      expect(() => manager.cancelQuestionTimeout(5)).not.toThrow();
      // Allow the fire-and-forget promise's .catch handler to run.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockLoggerInstance.error).toHaveBeenCalled();
    });
  });

  describe('api.* への委譲（executeTask 経由の ipc バインディング検証を含む）', () => {
    const task: AgentTask = { id: 1, title: 'test task' };
    const options: ExecutionOptions = { taskId: 1, sessionId: 2 };

    it('executeTask は api.executeTask にバインド済み ipc と引数を渡し結果を返す', async () => {
      const expected: AgentExecutionResult = { success: true, output: 'done' };
      mockExecuteTask.mockResolvedValueOnce(expected);

      const result = await manager.executeTask(task, options);

      expect(result).toBe(expected);
      expect(mockExecuteTask).toHaveBeenCalledTimes(1);
      const [passedIpc, passedTask, passedOptions] = mockExecuteTask.mock.calls[0];
      expect(passedTask).toBe(task);
      expect(passedOptions).toBe(options);
      expect(typeof passedIpc).toBe('function');
    });

    it('executeTask に渡された ipc 関数は実際に sendIPCRequest へ委譲する', async () => {
      mockExecuteTask.mockResolvedValueOnce({ success: true, output: '' });
      await manager.executeTask(task, options);

      const passedIpc = mockExecuteTask.mock.calls[0][0] as (
        type: string,
        data: Record<string, unknown>,
        timeoutMs?: number,
      ) => Promise<unknown>;
      sendIPCRequestMock.mockResolvedValueOnce('proxied-result');

      const result = await passedIpc('probe-type', { foo: 1 }, 999);

      expect(result).toBe('proxied-result');
      expect(sendIPCRequestMock).toHaveBeenLastCalledWith(
        null,
        false,
        expect.any(Map),
        expect.any(Function),
        'probe-type',
        { foo: 1 },
        999,
      );
    });

    it('executeContinuation は api.executeContinuation に委譲する（options 省略時は既定値 {}）', async () => {
      await manager.executeContinuation(11, 'yes');
      expect(mockExecuteContinuation).toHaveBeenCalledWith(expect.any(Function), 11, 'yes', {});
    });

    it('executeContinuationWithLock は api.executeContinuationWithLock に委譲する', async () => {
      const opts = { timeout: 100 };
      await manager.executeContinuationWithLock(12, 'no', opts);
      expect(mockExecuteContinuationWithLock).toHaveBeenCalledWith(
        expect.any(Function),
        12,
        'no',
        opts,
      );
    });

    it('resumeInterruptedExecution は api.resumeInterruptedExecution に委譲する', async () => {
      await manager.resumeInterruptedExecution(13);
      expect(mockResumeInterruptedExecution).toHaveBeenCalledWith(expect.any(Function), 13, {});
    });

    it('getSessionExecutionsAsync は api.getSessionExecutionsAsync に委譲する', async () => {
      await manager.getSessionExecutionsAsync(14);
      expect(mockGetSessionExecutionsAsync).toHaveBeenCalledWith(expect.any(Function), 14);
    });

    it('getQuestionTimeoutInfoAsync は api.getQuestionTimeoutInfoAsync に委譲する', async () => {
      await manager.getQuestionTimeoutInfoAsync(15);
      expect(mockGetQuestionTimeoutInfoAsync).toHaveBeenCalledWith(expect.any(Function), 15);
    });
  });

  describe('getActiveExecutionIdsAsync — readiness ガード', () => {
    it('isWorkerReady=false のとき IPC を呼ばず即 [] を返す', async () => {
      const state = (manager as unknown as ManagerWithPrivateState).state;
      state.isWorkerReady = false;
      state.isShuttingDown = false;

      const result = await manager.getActiveExecutionIdsAsync();

      expect(result).toEqual([]);
      expect(mockGetActiveExecutionIdsAsync).not.toHaveBeenCalled();
    });

    it('isShuttingDown=true のとき IPC を呼ばず即 [] を返す', async () => {
      const state = (manager as unknown as ManagerWithPrivateState).state;
      state.isWorkerReady = true;
      state.isShuttingDown = true;

      const result = await manager.getActiveExecutionIdsAsync();

      expect(result).toEqual([]);
      expect(mockGetActiveExecutionIdsAsync).not.toHaveBeenCalled();
    });

    it('isWorkerReady=true かつ isShuttingDown=false のとき api.getActiveExecutionIdsAsync に委譲する', async () => {
      const state = (manager as unknown as ManagerWithPrivateState).state;
      state.isWorkerReady = true;
      state.isShuttingDown = false;
      mockGetActiveExecutionIdsAsync.mockResolvedValueOnce([100, 200]);

      const result = await manager.getActiveExecutionIdsAsync();

      expect(result).toEqual([100, 200]);
      expect(mockGetActiveExecutionIdsAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('git.* への委譲', () => {
    it('createBranch は git.createBranch に委譲する', async () => {
      mockCreateBranch.mockResolvedValueOnce(true);
      const result = await manager.createBranch('/repo', 'feature/x');
      expect(result).toBe(true);
      expect(mockCreateBranch).toHaveBeenCalledWith(expect.any(Function), '/repo', 'feature/x');
    });

    it('createWorktree は git.createWorktree にすべての引数を委譲する', async () => {
      mockCreateWorktree.mockResolvedValueOnce('/tmp/wt-1');
      const result = await manager.createWorktree('/repo', 'feature/x', 9, 'git@x', 'develop');
      expect(result).toBe('/tmp/wt-1');
      expect(mockCreateWorktree).toHaveBeenCalledWith(
        expect.any(Function),
        '/repo',
        'feature/x',
        9,
        'git@x',
        'develop',
      );
    });

    it('removeWorktree は git.removeWorktree に委譲する', async () => {
      await manager.removeWorktree('/repo', '/tmp/wt-1');
      expect(mockRemoveWorktree).toHaveBeenCalledWith(expect.any(Function), '/repo', '/tmp/wt-1');
    });

    it('cleanupStaleWorktrees は git.cleanupStaleWorktrees に委譲する', async () => {
      mockCleanupStaleWorktrees.mockResolvedValueOnce(2);
      const result = await manager.cleanupStaleWorktrees('/repo');
      expect(result).toBe(2);
      expect(mockCleanupStaleWorktrees).toHaveBeenCalledWith(expect.any(Function), '/repo');
    });

    it('commitChanges は git.commitChanges に委譲する', async () => {
      await manager.commitChanges('/repo', 'msg', 'title');
      expect(mockCommitChanges).toHaveBeenCalledWith(expect.any(Function), '/repo', 'msg', 'title');
    });

    it('createCommit は git.createCommit に委譲する', async () => {
      await manager.createCommit('/repo', 'msg');
      expect(mockCreateCommit).toHaveBeenCalledWith(expect.any(Function), '/repo', 'msg');
    });

    it('createPullRequest は git.createPullRequest に既定 baseBranch=main で委譲する', async () => {
      await manager.createPullRequest('/repo', 'title', 'body');
      expect(mockCreatePullRequest).toHaveBeenCalledWith(
        expect.any(Function),
        '/repo',
        'title',
        'body',
        'main',
      );
    });

    it('mergePullRequest は git.mergePullRequest に既定引数で委譲する', async () => {
      await manager.mergePullRequest('/repo', 5);
      expect(mockMergePullRequest).toHaveBeenCalledWith(
        expect.any(Function),
        '/repo',
        5,
        5,
        'master',
      );
    });

    it('getGitDiff は git.getGitDiff に委譲する', async () => {
      mockGetGitDiff.mockResolvedValueOnce('diff-text');
      const result = await manager.getGitDiff('/repo');
      expect(result).toBe('diff-text');
      expect(mockGetGitDiff).toHaveBeenCalledWith(expect.any(Function), '/repo');
    });

    it('getFullGitDiff は git.getFullGitDiff に委譲する', async () => {
      await manager.getFullGitDiff('/repo');
      expect(mockGetFullGitDiff).toHaveBeenCalledWith(expect.any(Function), '/repo');
    });

    it('getDiff は git.getDiff に委譲する', async () => {
      const files = [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0 }];
      mockGetDiff.mockResolvedValueOnce(files);
      const result = await manager.getDiff('/repo');
      expect(result).toBe(files);
      expect(mockGetDiff).toHaveBeenCalledWith(expect.any(Function), '/repo');
    });

    it('revertChanges は git.revertChanges に委譲する', async () => {
      mockRevertChanges.mockResolvedValueOnce(false);
      const result = await manager.revertChanges('/repo');
      expect(result).toBe(false);
      expect(mockRevertChanges).toHaveBeenCalledWith(expect.any(Function), '/repo');
    });
  });

  describe('同期互換スタブメソッド', () => {
    it('getSessionExecutions は常に空配列を返す', () => {
      expect(manager.getSessionExecutions(1)).toEqual([]);
    });

    it('getActiveAgentInfos は常に空配列を返す', () => {
      expect(manager.getActiveAgentInfos()).toEqual([]);
    });

    it('getActiveExecutions は常に空配列を返す', () => {
      expect(manager.getActiveExecutions()).toEqual([]);
    });

    it('getExecutionState は常に undefined を返す', () => {
      expect(manager.getExecutionState(1)).toBeUndefined();
    });
  });

  describe('その他のオーケストレーター互換スタブ', () => {
    it('addEventListener / removeEventListener は例外を投げない', () => {
      const listener = () => {};
      expect(() => manager.addEventListener(listener)).not.toThrow();
      expect(() => manager.removeEventListener(listener)).not.toThrow();
    });

    it('setServerStopCallback は例外を投げない', () => {
      expect(() => manager.setServerStopCallback(() => {})).not.toThrow();
    });

    it('stopServer は解決される', async () => {
      await expect(manager.stopServer()).resolves.toBeUndefined();
    });

    it('isInShutdown は state.isShuttingDown を反映する', () => {
      const state = (manager as unknown as ManagerWithPrivateState).state;
      state.isShuttingDown = true;
      expect(manager.isInShutdown()).toBe(true);
      state.isShuttingDown = false;
      expect(manager.isInShutdown()).toBe(false);
    });

    it('getIsWorkerReady は state.isWorkerReady を反映する', () => {
      const state = (manager as unknown as ManagerWithPrivateState).state;
      state.isWorkerReady = true;
      expect(manager.getIsWorkerReady()).toBe(true);
      state.isWorkerReady = false;
      expect(manager.getIsWorkerReady()).toBe(false);
    });
  });

  describe('gracefulShutdown', () => {
    it('worker-shutdown.gracefulShutdown に現在の state を渡す', async () => {
      const state = (manager as unknown as ManagerWithPrivateState).state;

      await manager.gracefulShutdown();

      expect(gracefulShutdownMock).toHaveBeenCalledWith(state);
    });

    it('skipServerStop オプションを渡しても実行できる', async () => {
      await expect(manager.gracefulShutdown({ skipServerStop: true })).resolves.toBeUndefined();
    });
  });
});
