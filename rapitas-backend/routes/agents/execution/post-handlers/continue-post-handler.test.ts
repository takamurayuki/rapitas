/**
 * continue-post-handler.test
 *
 * handleContinueResult: 成功パス・失敗パスの両方で continue-execution 経由の
 * PR自動検出/リンク処理(linkContinueExecutionPr)が、既存の完了処理をブロック
 * せず呼ばれることを検証する（task #1058）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const mockTaskUpdate = mock(() => Promise.resolve({}));
const mockSessionUpdate = mock(() => Promise.resolve({}));
let sessionRow: { mode: string | null } | null = { mode: null };
let sessionReadFails = false;
const mockSessionFindUnique = mock(() =>
  sessionReadFails ? Promise.reject(new Error('db down')) : Promise.resolve(sessionRow),
);

mock.module('../../../../config/database', () => ({
  prisma: {
    task: { update: mockTaskUpdate },
    agentSession: { update: mockSessionUpdate, findUnique: mockSessionFindUnique },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../../config/logger', () => ({ createLogger: () => noopLogger }));

const mockApplyTaskStatusFromWorkflow = mock(() => Promise.resolve());
mock.module('../../../../services/workflow/apply-task-status-from-workflow', () => ({
  applyTaskStatusFromWorkflow: mockApplyTaskStatusFromWorkflow,
}));

const mockUpdateSessionStatusWithRetry = mock(() => Promise.resolve());
mock.module('../shared/session-helpers', () => ({
  updateSessionStatusWithRetry: mockUpdateSessionStatusWithRetry,
}));

mock.module('../shared/execution-lock', () => ({
  releaseTaskExecutionLock: () => {},
}));

mock.module('../../../../services/agents/agent-worker/shutdown-error', () => ({
  isShutdownError: () => false,
}));

const mockRemoveWorktree = mock(() => Promise.resolve(true));
mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: () => ({ removeWorktree: mockRemoveWorktree }),
  },
}));

let linkContinueExecutionPrMock: ReturnType<typeof mock>;
const callOrder: string[] = [];
mock.module('../../../../services/github/continue-execution-pr-link', () => ({
  linkContinueExecutionPr: (...args: unknown[]) => {
    callOrder.push('link');
    return linkContinueExecutionPrMock(...args);
  },
}));

const { handleContinueResult } = await import('./continue-post-handler');

function baseParams(overrides?: Partial<Parameters<typeof handleContinueResult>[0]>) {
  return {
    result: { success: true },
    taskId: 1058,
    taskTitle: 'test task',
    targetSessionId: 500,
    branchName: 'feature/1058',
    workingDirectory: '/main',
    executionDir: '/wt',
    ...overrides,
  };
}

describe('handleContinueResult — PR自動リンク呼び出し (task #1058)', () => {
  beforeEach(() => {
    mockTaskUpdate.mockClear();
    mockSessionUpdate.mockClear();
    mockApplyTaskStatusFromWorkflow.mockClear();
    mockUpdateSessionStatusWithRetry.mockClear();
    mockRemoveWorktree.mockClear();
    callOrder.length = 0;
    sessionRow = { mode: null };
    sessionReadFails = false;
    linkContinueExecutionPrMock = mock(() => Promise.resolve());
  });

  test('成功パスで検出関数が1回呼ばれ、removeWorktreeより先に実行される', async () => {
    await handleContinueResult(baseParams());

    expect(linkContinueExecutionPrMock).toHaveBeenCalledTimes(1);
    const arg = linkContinueExecutionPrMock.mock.calls[0][1] as {
      taskId: number;
      branchName: string;
      cwd: string;
    };
    expect(arg.taskId).toBe(1058);
    expect(arg.branchName).toBe('feature/1058');
    expect(arg.cwd).toBe('/wt');

    expect(callOrder).toEqual(['link']);
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);
    expect(mockApplyTaskStatusFromWorkflow).toHaveBeenCalledTimes(1);
  });

  test('失敗パスでも検出関数が1回呼ばれ、既存の todo/failed 更新は従来通り実行される', async () => {
    await handleContinueResult(baseParams({ result: { success: false, errorMessage: 'boom' } }));

    expect(linkContinueExecutionPrMock).toHaveBeenCalledTimes(1);
    expect(mockTaskUpdate).toHaveBeenCalledTimes(1);
    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: 1058 }, data: { status: 'todo' } });
    expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
  });

  test('検出関数がエラーをスローしても handleContinueResult 全体は正常終了する', async () => {
    linkContinueExecutionPrMock = mock(() => Promise.reject(new Error('gh boom')));

    await expect(handleContinueResult(baseParams())).resolves.toBeUndefined();
    expect(mockApplyTaskStatusFromWorkflow).toHaveBeenCalledTimes(1);
  });
});

// G2 routing1 re-review 6: the status sync must know a workflow run from a
// single-shot run, or a workflow task left in draft is marked done unverified.
describe('handleContinueResult — 状態同期へ実行種別を渡す', () => {
  beforeEach(() => {
    mockApplyTaskStatusFromWorkflow.mockClear();
    sessionRow = { mode: null };
    sessionReadFails = false;
    linkContinueExecutionPrMock = mock(() => Promise.resolve());
  });

  function passedRun(): unknown {
    return (mockApplyTaskStatusFromWorkflow.mock.calls[0] as unknown[])[3];
  }

  test('ワークフロー実行のセッションなら、その mode を渡す', async () => {
    sessionRow = { mode: 'workflow-researcher' };
    await handleContinueResult(baseParams());
    expect(passedRun()).toEqual({ sessionMode: 'workflow-researcher' });
  });

  test('単発実行のセッションなら null を渡す', async () => {
    await handleContinueResult(baseParams());
    expect(passedRun()).toEqual({ sessionMode: null });
  });

  test.each([
    ['セッションの読み取りに失敗した', true, { mode: null }],
    ['セッションの行がない', false, null],
  ])('%sときは undefined（不明）を渡す', async (_label, fails, row) => {
    sessionReadFails = fails;
    sessionRow = row;
    await handleContinueResult(baseParams());
    expect(passedRun()).toEqual({ sessionMode: undefined });
  });
});
