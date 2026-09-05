/**
 * resume-completion ユニットテスト
 *
 * handleResumeCompletion() の完了ハンドラを検証する。ResumeLockConflictError
 * は良性スキップとして task.status/agentSession.status を変更せず、通常の
 * Error は従来通り task.status を 'todo' に戻すことを確認する。成功系
 * （タスクステータス更新 + 通知）と既存の失敗系（'todo' への差し戻し +
 * agent_error 通知）も併せて検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Module-level mocks（import 前に宣言） ──────────────────────────────────────
// NOTE: mock.module はプロセスグローバル。他のテストファイルと同時実行すると
// mock が衝突するため、このファイルは単体（bun test <this file>）で実行する。

const taskUpdateMock = mock(async () => ({}));
const agentSessionUpdateMock = mock(async () => ({}));
const notificationCreateMock = mock(async () => ({}));
const taskFindUniqueMock = mock(async () => ({ workflowStatus: 'in_progress' }));

mock.module('../../../config', () => ({
  prisma: {
    task: { update: taskUpdateMock, findUnique: taskFindUniqueMock },
    agentSession: { update: agentSessionUpdateMock },
    notification: { create: notificationCreateMock },
  },
  ensureDatabaseConnection: mock(async () => {}),
  logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) }),
  getDbProvider: () => 'PostgreSQL',
  getInsensitiveMode: () => ({}),
  getProjectRoot: () => 'C:\\Projects\\rapitas',
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) }),
}));

let resumeInterruptedExecutionMock = mock(async () => ({ success: true, waitingForInput: false }));
const getFullGitDiffMock = mock(async () => 'No changes detected');

mock.module('../../core/orchestrator-instance', () => ({
  orchestrator: {
    resumeInterruptedExecution: (...args: unknown[]) => resumeInterruptedExecutionMock(...args),
    getFullGitDiff: (...args: unknown[]) => getFullGitDiffMock(...args),
  },
}));

// ── 動的 import（全 mock.module 宣言後） ──────────────────────────────────────

const { handleResumeCompletion } = await import('./resume-completion');
const { ResumeLockConflictError } = await import('./execution-resume');

// ── ヘルパー ──────────────────────────────────────────────────────────────────

const TASK = {
  id: 5,
  title: 'テストタスク',
  description: null,
  theme: { name: 'テーマ', workingDirectory: 'C:\\Users\\test\\project' },
};

const EXECUTION = {
  sessionId: 20,
  session: { config: { id: 1, taskId: 5 } },
};

/** マイクロタスク/タイマーキューを flush して fire-and-forget チェーンの完了を待つ。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(() => {
  taskUpdateMock.mockClear();
  agentSessionUpdateMock.mockClear();
  notificationCreateMock.mockClear();
  taskFindUniqueMock.mockClear();
  taskFindUniqueMock.mockImplementation(async () => ({ workflowStatus: 'in_progress' }));
  getFullGitDiffMock.mockClear();
  getFullGitDiffMock.mockImplementation(async () => 'No changes detected');
});

describe('handleResumeCompletion() — 成功系', () => {
  test('success かつ waitingForInput=false のとき、タスクステータスが更新され完了通知を作成する', async () => {
    resumeInterruptedExecutionMock = mock(async () => ({ success: true, waitingForInput: false }));

    handleResumeCompletion(10, EXECUTION, TASK, TASK.theme.workingDirectory, 900_000);
    await flush();

    expect(agentSessionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXECUTION.sessionId },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'agent_execution_complete' }),
      }),
    );
  });
});

describe('handleResumeCompletion() — 既存の失敗系', () => {
  test('resolve success=false の場合、taskをtodoへ差し戻し agent_error 通知を作成する', async () => {
    resumeInterruptedExecutionMock = mock(async () => ({
      success: false,
      waitingForInput: false,
      errorMessage: 'resume failed',
    }));

    handleResumeCompletion(10, EXECUTION, TASK, TASK.theme.workingDirectory, 900_000);
    await flush();

    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TASK.id }, data: { status: 'todo' } }),
    );
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'agent_error' }) }),
    );
  });
});

describe('handleResumeCompletion() — ResumeLockConflictError', () => {
  test('ResumeLockConflictError の reject では task.status / agentSession.status を変更しない', async () => {
    resumeInterruptedExecutionMock = mock(async () => {
      throw new ResumeLockConflictError(TASK.id);
    });

    handleResumeCompletion(10, EXECUTION, TASK, TASK.theme.workingDirectory, 900_000);
    await flush();

    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(agentSessionUpdateMock).not.toHaveBeenCalled();
  });

  test('name プロパティのみで ResumeLockConflictError と判定できる場合も同様にスキップする', async () => {
    const nameOnlyError = new Error('lock conflict');
    nameOnlyError.name = 'ResumeLockConflictError';
    resumeInterruptedExecutionMock = mock(async () => {
      throw nameOnlyError;
    });

    handleResumeCompletion(10, EXECUTION, TASK, TASK.theme.workingDirectory, 900_000);
    await flush();

    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(agentSessionUpdateMock).not.toHaveBeenCalled();
  });
});

describe('handleResumeCompletion() — 通常エラーの既存挙動（回帰）', () => {
  test('通常の Error では task.status を todo に戻す', async () => {
    resumeInterruptedExecutionMock = mock(async () => {
      throw new Error('unexpected failure');
    });

    handleResumeCompletion(10, EXECUTION, TASK, TASK.theme.workingDirectory, 900_000);
    await flush();

    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK.id },
        data: { status: 'todo' },
      }),
    );
    expect(agentSessionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXECUTION.sessionId },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });
});
