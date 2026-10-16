/**
 * workflow-handlers-resume-stop-override.test
 *
 * Covers the `stopOverride` escape hatch on applyQuestionAnswerByKind (task
 * 944): a stop recorded while a task is already paused on a question leaves the
 * pause with no exit, so a human-sourced answer must be able to resolve it.
 * Not responsible for the other competing-answer guards — those live in
 * workflow-handlers-resume-dispatch.test.ts.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const mockFindFirstTransition = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
const mockUpdateMany = mock(() => Promise.resolve({ count: 1 }));
const mockTaskFindUnique = mock(() =>
  Promise.resolve<{ updatedAt: Date; workflowStatus: string | null } | null>({
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    workflowStatus: 'awaiting_question',
  }),
);
const mockTaskUpdate = mock(() => Promise.resolve({}));
const mockCreateTransition = mock(() => Promise.resolve(undefined));
mock.module('../../../config', () => ({
  prisma: {
    workflowTransition: { findFirst: mockFindFirstTransition, create: mockCreateTransition },
    task: { updateMany: mockUpdateMany, findUnique: mockTaskFindUnique, update: mockTaskUpdate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        task: { update: mockTaskUpdate },
        workflowTransition: { create: mockCreateTransition },
      }),
  },
  createLogger: () => noopLogger,
}));

const mockReadWorkflowFile = mock(() => Promise.resolve<string | null>(null));
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  readWorkflowFile: mockReadWorkflowFile,
}));

mock.module('../../../middleware/error-handler', () => ({
  NotFoundError: class NotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
  ValidationError: class ValidationError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ValidationError';
    }
  },
  ConflictError: class ConflictError extends Error {
    code?: string;
    constructor(msg: string, code?: string) {
      super(msg);
      this.name = 'ConflictError';
      this.code = code;
    }
  },
}));

const mockIsLatestExecutionCancelled = mock(() => Promise.resolve(false));
mock.module('../../../services/workflow/publication-cancellation-guard', () => ({
  isLatestExecutionCancelled: mockIsLatestExecutionCancelled,
}));

const mockApplyIntakeQuestionAnswerLocked = mock(() =>
  Promise.resolve({ taskId: 1, ok: true as const, toStatus: 'draft' as const }),
);
mock.module('./workflow-handlers-resume', () => ({
  applyIntakeQuestionAnswerLocked: mockApplyIntakeQuestionAnswerLocked,
}));

const mockApplyResumeFromQuestionAnswerLocked = mock(() =>
  Promise.resolve({
    taskId: 1,
    fromStatus: 'awaiting_question' as const,
    toStatus: 'plan_approved' as const,
    source: 'transition_metadata' as const,
  }),
);
mock.module('./workflow-handlers-resume-continuation', () => ({
  applyResumeFromQuestionAnswerLocked: mockApplyResumeFromQuestionAnswerLocked,
}));

const { applyQuestionAnswerByKind } = await import('./workflow-handlers-resume-dispatch');

/** An execution_continuation pause — the shape task 1283 was stuck in. */
const PENDING_PAUSE = {
  id: 7,
  cause: 'file_saved:question',
  fromStatus: 'plan_approved',
  metadata: { kind: 'execution_continuation', previousStatus: 'plan_approved' },
};

const BASE_PARAMS = {
  taskId: 1,
  answer: '回答本文',
  actor: 'user' as const,
  sourceLabel: 'ユーザー選択',
};

beforeEach(() => {
  mockFindFirstTransition.mockReset().mockResolvedValue(PENDING_PAUSE);
  mockUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  mockTaskFindUnique.mockReset().mockResolvedValue({
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    workflowStatus: 'awaiting_question',
  });
  mockTaskUpdate.mockReset().mockResolvedValue({});
  mockCreateTransition.mockReset().mockResolvedValue(undefined);
  mockReadWorkflowFile.mockReset().mockResolvedValue(null);
  // Every test here starts from the dead end: a stop is on record.
  mockIsLatestExecutionCancelled.mockReset().mockResolvedValue(true);
  mockApplyIntakeQuestionAnswerLocked
    .mockReset()
    .mockResolvedValue({ taskId: 1, ok: true, toStatus: 'draft' });
  mockApplyResumeFromQuestionAnswerLocked.mockReset().mockResolvedValue({
    taskId: 1,
    fromStatus: 'awaiting_question',
    toStatus: 'plan_approved',
    source: 'transition_metadata',
  });
});

describe('applyQuestionAnswerByKind — stopOverride (task 944)', () => {
  test('a human answer with stopOverride resolves a pause that an unresumed stop had sealed', async () => {
    const result = await applyQuestionAnswerByKind({ ...BASE_PARAMS, stopOverride: true });

    expect(result.toStatus).toBe('plan_approved');
    expect(result.kind).toBe('execution_continuation');
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalledTimes(1);
  });

  test('the override is recorded on the transition so it is auditable', async () => {
    await applyQuestionAnswerByKind({ ...BASE_PARAMS, stopOverride: true });

    const call = mockApplyResumeFromQuestionAnswerLocked.mock.calls[0][0] as {
      extraMetadata?: Record<string, unknown>;
    };
    expect(call.extraMetadata?.stopOverridden).toBe(true);
  });

  test('an answer without stopOverride still rejects with task_stopping', async () => {
    await expect(applyQuestionAnswerByKind(BASE_PARAMS)).rejects.toThrow(
      'タスクの実行が停止されています',
    );
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('the system heal pass cannot override a stop even when it asks to', async () => {
    await expect(
      applyQuestionAnswerByKind({
        ...BASE_PARAMS,
        actor: 'system',
        stopOverride: true,
      }),
    ).rejects.toThrow('タスクの実行が停止されています');
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('a task that already left the pause is not overridable — the dead end does not apply', async () => {
    mockTaskFindUnique.mockResolvedValue({
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      workflowStatus: 'in_progress',
    });

    await expect(applyQuestionAnswerByKind({ ...BASE_PARAMS, stopOverride: true })).rejects.toThrow(
      'タスクの実行が停止されています',
    );
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('no stop on record: stopOverride changes nothing and adds no metadata', async () => {
    mockIsLatestExecutionCancelled.mockResolvedValue(false);

    await applyQuestionAnswerByKind({ ...BASE_PARAMS, stopOverride: true });

    const call = mockApplyResumeFromQuestionAnswerLocked.mock.calls[0][0] as {
      extraMetadata?: Record<string, unknown>;
    };
    expect(call.extraMetadata).not.toHaveProperty('stopOverridden');
  });
});
