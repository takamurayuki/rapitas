/**
 * auto-resume.test
 *
 * Unit tests for the pure auto-resume decision core (attempt counting and
 * the guard matrix). The prisma/orchestrator shell is exercised through the
 * manual-resume flow it reuses.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const findUniqueMock = mock(async () => null as unknown);
const findFirstMock = mock(async () => null as unknown);
const taskUpdateMock = mock(async () => ({}));
const notificationCreateMock = mock(async () => ({}));

mock.module('../../../config/database', () => ({
  prisma: {
    agentExecution: { findUnique: findUniqueMock, findFirst: findFirstMock },
    task: { update: taskUpdateMock },
    notification: { create: notificationCreateMock },
    userSettings: { findFirst: mock(async () => ({ autoResumeInterruptedTasks: true })) },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) }),
}));

const isTaskExecutionLockedMock = mock(() => false);
mock.module('../task-execution-lock', () => ({
  isTaskExecutionLocked: isTaskExecutionLockedMock,
}));

const handleResumeCompletionMock = mock(() => {});
mock.module('./resume-completion', () => ({
  handleResumeCompletion: handleResumeCompletionMock,
}));

const { countResumeAttempts, decideAutoResume, autoResumeInterruptedExecutions } =
  await import('./auto-resume');

const NOW = new Date('2026-08-07T12:00:00Z');

function exec(over: Partial<{ status: string; createdAt: Date; output: string | null }> = {}) {
  return {
    status: 'interrupted',
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 1h ago
    output: 'some output',
    ...over,
  };
}

const OK_OPTS = {
  now: NOW,
  hasNewerExecution: false,
  taskStatus: 'todo',
  hasWorkingDirectory: true,
  isTaskLocked: false,
};

describe('countResumeAttempts', () => {
  it('counts the resume markers in the output', () => {
    expect(countResumeAttempts(null)).toBe(0);
    expect(countResumeAttempts('no markers')).toBe(0);
    expect(countResumeAttempts('x\n[再開] 中断された作業を再開します...\ny')).toBe(1);
    expect(
      countResumeAttempts(
        '[再開] 中断された作業を再開します...\nwork\n[再開] 中断された作業を再開します...\n',
      ),
    ).toBe(2);
  });
});

describe('decideAutoResume', () => {
  it('resumes a fresh interrupted execution with no prior attempts', () => {
    expect(decideAutoResume(exec(), OK_OPTS).resume).toBe(true);
  });

  it('skips non-interrupted executions', () => {
    expect(decideAutoResume(exec({ status: 'running' }), OK_OPTS).resume).toBe(false);
  });

  it('skips when the theme has no working directory', () => {
    const d = decideAutoResume(exec(), { ...OK_OPTS, hasWorkingDirectory: false });
    expect(d.resume).toBe(false);
    expect(d.reason).toContain('WorkingDirectory');
  });

  it('skips done/cancelled tasks', () => {
    expect(decideAutoResume(exec(), { ...OK_OPTS, taskStatus: 'done' }).resume).toBe(false);
    expect(decideAutoResume(exec(), { ...OK_OPTS, taskStatus: 'cancelled' }).resume).toBe(false);
  });

  it('skips blocked/failed tasks', () => {
    expect(decideAutoResume(exec(), { ...OK_OPTS, taskStatus: 'blocked' }).resume).toBe(false);
    expect(decideAutoResume(exec(), { ...OK_OPTS, taskStatus: 'failed' }).resume).toBe(false);
  });

  it('skips when a newer execution already took the task over', () => {
    const d = decideAutoResume(exec(), { ...OK_OPTS, hasNewerExecution: true });
    expect(d.resume).toBe(false);
    expect(d.reason).toContain('newer execution');
  });

  it('skips executions older than the freshness window', () => {
    const old = exec({ createdAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) });
    expect(decideAutoResume(old, OK_OPTS).resume).toBe(false);
  });

  it('skips once the resume budget is exhausted', () => {
    const twice = exec({
      output: '[再開] 中断された作業を再開します...\n…\n[再開] 中断された作業を再開します...\n…',
    });
    const d = decideAutoResume(twice, OK_OPTS);
    expect(d.resume).toBe(false);
    expect(d.reason).toContain('budget');
  });

  it('still resumes with exactly one prior attempt (budget is 2)', () => {
    const once = exec({ output: '[再開] 中断された作業を再開します...\n…' });
    expect(decideAutoResume(once, OK_OPTS).resume).toBe(true);
  });

  it('isTaskLocked=true のとき resume しない', () => {
    const d = decideAutoResume(exec(), { ...OK_OPTS, isTaskLocked: true });
    expect(d.resume).toBe(false);
    expect(d.reason).toContain('locked');
  });
});

describe('autoResumeInterruptedExecutions — ロック中タスクのスキップ', () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
    findFirstMock.mockClear();
    taskUpdateMock.mockClear();
    notificationCreateMock.mockClear();
    handleResumeCompletionMock.mockClear();
    isTaskExecutionLockedMock.mockClear();
    isTaskExecutionLockedMock.mockImplementation(() => false);
  });

  const execution = {
    id: 10,
    status: 'interrupted',
    // NOTE: autoResumeInterruptedExecutions uses the real clock (new Date()) for
    // the freshness check, not the fixed NOW constant used elsewhere in this file.
    createdAt: new Date(),
    output: 'previous output',
    session: {
      config: {
        task: {
          id: 5,
          title: 'テストタスク',
          description: null,
          status: 'todo',
          theme: { name: 'テーマ', workingDirectory: 'C:\\Users\\test\\project' },
        },
      },
    },
  };

  it('isTaskExecutionLocked=true のとき task.update/notification.create/handleResumeCompletion を呼ばない', async () => {
    findUniqueMock.mockImplementationOnce(async () => execution);
    findFirstMock.mockImplementationOnce(async () => null);
    isTaskExecutionLockedMock.mockImplementation(() => true);

    const started = await autoResumeInterruptedExecutions([10]);

    expect(started).toBe(0);
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(handleResumeCompletionMock).not.toHaveBeenCalled();
  });

  it('isTaskExecutionLocked=false かつ他条件が満たされていれば resume を開始する', async () => {
    findUniqueMock.mockImplementationOnce(async () => execution);
    findFirstMock.mockImplementationOnce(async () => null);
    isTaskExecutionLockedMock.mockImplementation(() => false);

    const started = await autoResumeInterruptedExecutions([10]);

    expect(started).toBe(1);
    expect(taskUpdateMock).toHaveBeenCalledTimes(1);
    expect(handleResumeCompletionMock).toHaveBeenCalledTimes(1);
  });
});
