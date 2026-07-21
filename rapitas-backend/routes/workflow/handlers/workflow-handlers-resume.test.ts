/**
 * workflow-handlers-resume.test
 *
 * Tests for handleAnswerWorkflowQuestion (intake question.md answer -> reset to
 * draft, plus clearing a stale task.status='blocked') and handleResumeFromQuestion
 * (awaiting_question -> recorded previousStatus).
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

// ---- prisma mock ----
const mockFindUnique = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
const mockUpdate = mock(() => Promise.resolve({}));
const mockFindFirstTransition = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    update: mockUpdate,
  },
  workflowTransition: {
    findFirst: mockFindFirstTransition,
  },
};
mock.module('../../../config', () => ({
  prisma: mockPrisma,
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

// ---- recordTransition mock ----
const mockRecordTransition = mock(() => Promise.resolve());
mock.module('../../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

// ---- archiveWorkflowFile mock ----
const mockArchiveWorkflowFile = mock(() => Promise.resolve());
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  archiveWorkflowFile: mockArchiveWorkflowFile,
}));

// ---- task-resolver mock ----
const mockResolveTaskWorkflowState = mock(() =>
  Promise.resolve<Record<string, unknown> | null>(null),
);
mock.module('../../../services/task/task-resolver', () => ({
  resolveTaskWorkflowState: mockResolveTaskWorkflowState,
}));

// ---- middleware mock ----
mock.module('../../../middleware/error-handler', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ValidationError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
}));

const { handleAnswerWorkflowQuestion, handleResumeFromQuestion } =
  await import('./workflow-handlers-resume');

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset().mockResolvedValue({});
  mockFindFirstTransition.mockReset();
  mockRecordTransition.mockReset().mockResolvedValue(undefined);
  mockArchiveWorkflowFile.mockReset().mockResolvedValue(undefined);
  mockResolveTaskWorkflowState.mockReset();
});

describe('handleAnswerWorkflowQuestion', () => {
  test('resets workflowStatus to draft and does NOT touch task.status when not blocked', async () => {
    mockFindUnique.mockResolvedValue({
      id: 503,
      description: '既存の説明',
      goals: '[]',
      workflowStatus: 'awaiting_question',
      status: 'todo',
    });

    const result = await handleAnswerWorkflowQuestion({
      params: { taskId: '503' },
      body: { answer: '追跡者数はアクティブな情報源(source)の数を指します' },
      set: {},
    });

    expect(result).toEqual({ taskId: 503, ok: true, toStatus: 'draft' });
    const updateArgs = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.workflowStatus).toBe('draft');
    expect(updateArgs.data.status).toBeUndefined();
  });

  test('clears a stale task.status="blocked" back to "todo" so the scheduler can re-dispatch', async () => {
    mockFindUnique.mockResolvedValue({
      id: 503,
      description: '既存の説明',
      goals: '[]',
      workflowStatus: 'awaiting_question',
      status: 'blocked',
    });

    await handleAnswerWorkflowQuestion({
      params: { taskId: '503' },
      body: { answer: '選択肢Aで進めてください' },
      set: {},
    });

    const updateArgs = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.workflowStatus).toBe('draft');
    expect(updateArgs.data.status).toBe('todo');
  });

  test('archives question.md and records an intake_question_answered transition', async () => {
    mockFindUnique.mockResolvedValue({
      id: 7,
      description: null,
      goals: null,
      workflowStatus: 'awaiting_question',
      status: 'blocked',
    });

    await handleAnswerWorkflowQuestion({
      params: { taskId: '7' },
      body: { answer: '回答内容' },
      set: {},
    });

    expect(mockArchiveWorkflowFile).toHaveBeenCalledWith(7, 'question');
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 7, toStatus: 'draft', cause: 'intake_question_answered' }),
    );
  });

  test('rejects an invalid taskId', async () => {
    const set: { status?: number } = {};
    await expect(
      handleAnswerWorkflowQuestion({ params: { taskId: 'abc' }, body: { answer: 'x' }, set }),
    ).rejects.toThrow('Invalid taskId');
    expect(set.status).toBe(400);
  });

  test('rejects a missing/blank answer', async () => {
    const set: { status?: number } = {};
    await expect(
      handleAnswerWorkflowQuestion({ params: { taskId: '1' }, body: { answer: '   ' }, set }),
    ).rejects.toThrow('answer is required');
    expect(set.status).toBe(400);
  });

  test('throws NotFoundError when the task does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const set: { status?: number } = {};
    await expect(
      handleAnswerWorkflowQuestion({ params: { taskId: '999' }, body: { answer: 'x' }, set }),
    ).rejects.toThrow('Task not found');
    expect(set.status).toBe(404);
  });
});

describe('handleResumeFromQuestion', () => {
  test('resumes to the previousStatus recorded in the awaiting_question transition metadata', async () => {
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 503,
      workflowStatus: 'awaiting_question',
    });
    mockFindFirstTransition.mockResolvedValue({
      metadata: { previousStatus: 'research_done' },
      fromStatus: 'research_done',
    });

    const result = await handleResumeFromQuestion({ params: { taskId: '503' }, set: {} });

    expect(result).toEqual({
      taskId: 503,
      fromStatus: 'awaiting_question',
      toStatus: 'research_done',
      source: 'transition_metadata',
    });
  });

  test('rejects when the task is not currently awaiting_question', async () => {
    mockResolveTaskWorkflowState.mockResolvedValue({ id: 503, workflowStatus: 'draft' });
    const set: { status?: number } = {};
    await expect(handleResumeFromQuestion({ params: { taskId: '503' }, set })).rejects.toThrow(
      /expected "awaiting_question"/,
    );
    expect(set.status).toBe(400);
  });
});
