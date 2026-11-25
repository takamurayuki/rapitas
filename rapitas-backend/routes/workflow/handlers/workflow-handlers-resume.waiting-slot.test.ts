/**
 * workflow-handlers-resume.waiting-slot.test
 *
 * task 1535: when a paused theme has no free global slot, the answer API still saves the
 * answer but reports that the task is waiting for a slot instead of claiming it resumed.
 * Kept apart from workflow-handlers-resume.test.ts, which is over the file-size limit.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

// ---- prisma mock ----
const mockFindUnique = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
const mockUpdate = mock(() => Promise.resolve({}));
const mockUpdateMany = mock(() => Promise.resolve({ count: 0 }));
const mockFindFirstTransition = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    update: mockUpdate,
    updateMany: mockUpdateMany,
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

// ---- workflow-file-utils mock (archive/read/write) ----
const mockArchiveWorkflowFile = mock(() => Promise.resolve());
const mockReadWorkflowFile = mock(() => Promise.resolve<string | null>(null));
const mockWriteWorkflowFile = mock(() => Promise.resolve(''));
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  archiveWorkflowFile: mockArchiveWorkflowFile,
  readWorkflowFile: mockReadWorkflowFile,
  writeWorkflowFile: mockWriteWorkflowFile,
}));

// ---- task-resolver mock ----
const mockResolveTaskWorkflowState = mock(() =>
  Promise.resolve<Record<string, unknown> | null>(null),
);
mock.module('../../../services/task/task-resolver', () => ({
  resolveTaskWorkflowState: mockResolveTaskWorkflowState,
}));

// ---- publication-cancellation-guard mock (task 902 dispatcher's stop check) ----
const mockIsLatestExecutionCancelled = mock(() => Promise.resolve(false));
mock.module('../../../services/workflow/publication-cancellation-guard', () => ({
  isLatestExecutionCancelled: mockIsLatestExecutionCancelled,
}));

// ---- redispatch collaborator mock (task 830; see workflow-handlers-resume-redispatch.test.ts) ----
const mockTriggerReExecutionAfterAnswer = mock(() =>
  Promise.resolve<'started' | 'waiting_slot'>('started'),
);
const mockTriggerRedispatchAfterResume = mock(() => Promise.resolve());
mock.module('./workflow-handlers-resume-redispatch', () => ({
  triggerReExecutionAfterAnswer: mockTriggerReExecutionAfterAnswer,
  triggerRedispatchAfterResume: mockTriggerRedispatchAfterResume,
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
  ConflictError: class ConflictError extends Error {
    code?: string;
    constructor(msg: string, code?: string) {
      super(msg);
      this.name = 'ConflictError';
      this.code = code;
    }
  },
}));

const { handleAnswerWorkflowQuestion } = await import('./workflow-handlers-resume');

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset().mockResolvedValue({});
  // Default: the dispatcher's compare-and-swap "claim" touch succeeds. Tests
  // covering the competing-answer conflict override this to { count: 0 }.
  mockUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  // Default: a single intake_question pause with no explicit kind — resolves
  // to kind=spec_change (matching the pre-902 always-reset_draft behavior)
  // via workflow-handlers-resume-dispatch.ts's target/staleness lookups.
  mockFindFirstTransition
    .mockReset()
    .mockResolvedValue({ id: 1, cause: 'intake_question', fromStatus: 'draft', metadata: {} });
  mockRecordTransition.mockReset().mockResolvedValue(undefined);
  mockArchiveWorkflowFile.mockReset().mockResolvedValue(undefined);
  mockReadWorkflowFile.mockReset().mockResolvedValue(null);
  mockWriteWorkflowFile.mockReset().mockResolvedValue('');
  mockResolveTaskWorkflowState.mockReset();
  mockTriggerReExecutionAfterAnswer.mockReset().mockResolvedValue(undefined);
  mockTriggerRedispatchAfterResume.mockReset().mockResolvedValue(undefined);
  mockIsLatestExecutionCancelled.mockReset().mockResolvedValue(false);
});

beforeEach(() => {
  mockFindUnique.mockReset().mockResolvedValue({
    id: 503,
    description: '説明',
    goals: '[]',
    workflowStatus: 'awaiting_question',
    status: 'todo',
  });
  mockUpdate.mockReset().mockResolvedValue({});
  mockUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  mockFindFirstTransition
    .mockReset()
    .mockResolvedValue({ id: 1, cause: 'intake_question', fromStatus: 'draft', metadata: {} });
  mockRecordTransition.mockReset().mockResolvedValue(undefined);
  mockArchiveWorkflowFile.mockReset().mockResolvedValue(undefined);
  mockReadWorkflowFile.mockReset().mockResolvedValue(null);
  mockWriteWorkflowFile.mockReset().mockResolvedValue('');
  mockResolveTaskWorkflowState.mockReset();
  mockTriggerRedispatchAfterResume.mockReset().mockResolvedValue(undefined);
  mockIsLatestExecutionCancelled.mockReset().mockResolvedValue(false);
});

const call = () =>
  handleAnswerWorkflowQuestion({
    params: { taskId: '503' },
    body: { answer: 'A: 現状のまま' },
    set: {},
    headers: { 'x-rapitas-source': 'ui' },
  });

describe('handleAnswerWorkflowQuestion — 枠待ちの応答 (task 1535)', () => {
  test('枠が取れて再開したら waitingForSlot を付けない（従来の応答形のまま）', async () => {
    mockTriggerReExecutionAfterAnswer.mockReset().mockResolvedValue('started');
    const result = await call();
    expect(result).toEqual({
      taskId: 503,
      ok: true,
      toStatus: 'draft',
      resolvedKind: 'spec_change',
    });
    expect(result).not.toHaveProperty('waitingForSlot');
  }, 30_000);

  test('一時停止テーマで枠が無ければ、回答は保存したまま waitingForSlot:true を返す', async () => {
    mockTriggerReExecutionAfterAnswer.mockReset().mockResolvedValue('waiting_slot');
    const result = await call();
    expect(result).toMatchObject({
      taskId: 503,
      ok: true,
      toStatus: 'draft',
      waitingForSlot: true,
    });
    // The answer was persisted before the resume attempt.
    expect(mockRecordTransition).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  }, 30_000);
});
