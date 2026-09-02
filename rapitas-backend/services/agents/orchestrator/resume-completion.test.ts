/**
 * resume-completion ユニットテスト
 *
 * handleResumeCompletion() の成功系（タスクステータス更新）、既存の失敗系
 * （'todo' への差し戻し + agent_error 通知）、そして ResumeLockConflictError
 * による良性スキップ（DB を一切書き換えない）を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const taskFindUniqueMock = mock(async () => ({ workflowStatus: 'completed' }));
const taskUpdateMock = mock(async () => ({}));
const agentSessionUpdateMock = mock(async () => ({}));
const notificationCreateMock = mock(async () => ({}));

mock.module('../../../config', () => ({
  prisma: {
    task: { findUnique: taskFindUniqueMock, update: taskUpdateMock },
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

const sharedLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};
mock.module('../../../config/logger', () => ({ createLogger: () => sharedLogger }));

const resumeMock = mock(async () => ({ success: true, waitingForInput: false }));
const getFullGitDiffMock = mock(async () => 'No changes detected');
mock.module('../../core/orchestrator-instance', () => ({
  orchestrator: {
    resumeInterruptedExecution: resumeMock,
    getFullGitDiff: getFullGitDiffMock,
  },
}));

// NOTE: execution-resume.ts pulls in agent-factory/execution-file-logger/etc —
// mock the whole module so importing ResumeLockConflictError here doesn't need
// to satisfy that entire dependency chain. resume-completion.ts imports the
// same specifier, so both sides see the identical class (instanceof holds).
class MockResumeLockConflictError extends Error {
  constructor(public readonly taskId: number) {
    super(`Task ${taskId} already has an active execution — refusing duplicate resume`);
    this.name = 'ResumeLockConflictError';
  }
}
mock.module('./execution-resume', () => ({
  ResumeLockConflictError: MockResumeLockConflictError,
}));

const { handleResumeCompletion } = await import('./resume-completion');
const { ResumeLockConflictError } = await import('./execution-resume');

const TASK = { id: 5, title: 'テストタスク', description: null, theme: null };
const EXECUTION = { sessionId: 20, session: { config: { id: 1, taskId: 5 } } };

/** handleResumeCompletion は fire-and-forget なので、内部の非同期処理を待つ小さな遅延。 */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  taskFindUniqueMock.mockClear();
  taskUpdateMock.mockClear();
  agentSessionUpdateMock.mockClear();
  notificationCreateMock.mockClear();
  sharedLogger.warn.mockClear();
  sharedLogger.error.mockClear();
  resumeMock.mockClear();
  resumeMock.mockImplementation(async () => ({ success: true, waitingForInput: false }));
});

describe('handleResumeCompletion() — 成功系', () => {
  test('success かつ waitingForInput=false のとき、タスクステータスが更新される', async () => {
    handleResumeCompletion(10, EXECUTION, TASK, 'C:\\work', 900000);
    await flushMicrotasks();

    expect(taskUpdateMock).toHaveBeenCalled();
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'agent_execution_complete' }),
      }),
    );
  });
});

describe('handleResumeCompletion() — 既存の失敗系', () => {
  test('resumeInterruptedExecution が reject した場合、taskをtodoへ差し戻し agent_error 通知を作成する', async () => {
    resumeMock.mockImplementation(async () => {
      throw new Error('boom');
    });

    handleResumeCompletion(10, EXECUTION, TASK, 'C:\\work', 900000);
    await flushMicrotasks();

    expect(taskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: { status: 'todo' } }),
    );
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'agent_error' }) }),
    );
  });
});

describe('handleResumeCompletion() — ロック競合の良性スキップ', () => {
  test('ResumeLockConflictError が reject された場合、task.update も notification.create も呼ばれない', async () => {
    resumeMock.mockImplementation(async () => {
      throw new ResumeLockConflictError(5);
    });

    handleResumeCompletion(10, EXECUTION, TASK, 'C:\\work', 900000);
    await flushMicrotasks();

    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sharedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, executionId: 10 }),
      expect.stringContaining('already holds the task lock'),
    );
  });
});
