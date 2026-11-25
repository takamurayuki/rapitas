/** 回答の保存・計画修正・枠待ち応答を実ハンドラで検証する。 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';
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
    create: mock(() => Promise.resolve({})),
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(mockPrisma),
};
mock.module('../../../config', () => ({
  prisma: mockPrisma,
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
const mockRecordTransition = mock(() => Promise.resolve());
mock.module('../../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));
const mockArchiveWorkflowFile = mock(() => Promise.resolve());
const mockReadWorkflowFile = mock(() => Promise.resolve<string | null>(null));
const mockWriteWorkflowFile = mock(() => Promise.resolve(''));
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  archiveWorkflowFile: mockArchiveWorkflowFile,
  readWorkflowFile: mockReadWorkflowFile,
  writeWorkflowFile: mockWriteWorkflowFile,
}));
const mockResolveTaskWorkflowState = mock(() =>
  Promise.resolve<Record<string, unknown> | null>(null),
);
mock.module('../../../services/task/task-resolver', () => ({
  resolveTaskWorkflowState: mockResolveTaskWorkflowState,
}));
const mockIsLatestExecutionCancelled = mock(() => Promise.resolve(false));
mock.module('../../../services/workflow/publication-cancellation-guard', () => ({
  isLatestExecutionCancelled: mockIsLatestExecutionCancelled,
}));
const mockTriggerReExecutionAfterAnswer = mock(() =>
  Promise.resolve<'started' | 'waiting_slot'>('started'),
);
const mockTriggerRedispatchAfterResume = mock(() => Promise.resolve());
mock.module('./workflow-handlers-resume-redispatch', () => ({
  triggerReExecutionAfterAnswer: mockTriggerReExecutionAfterAnswer,
  triggerRedispatchAfterResume: mockTriggerRedispatchAfterResume,
}));
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
  mockUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  mockFindFirstTransition
    .mockReset()
    .mockResolvedValue({ id: 1, cause: 'intake_question', fromStatus: 'draft', metadata: {} });
  mockRecordTransition.mockReset().mockResolvedValue(undefined);
  mockArchiveWorkflowFile.mockReset().mockResolvedValue(undefined);
  mockReadWorkflowFile.mockReset().mockResolvedValue(null);
  mockWriteWorkflowFile.mockReset().mockResolvedValue('');
  mockResolveTaskWorkflowState.mockReset();
  mockTriggerReExecutionAfterAnswer.mockReset().mockResolvedValue('started');
  mockTriggerRedispatchAfterResume.mockReset().mockResolvedValue(undefined);
  mockIsLatestExecutionCancelled.mockReset().mockResolvedValue(false);
});
describe('handleAnswerWorkflowQuestion', () => {
  test.each(['started', 'waiting_slot'] as const)(
    '計画修正回答の %s を保存後の応答へ反映する',
    async (result) => {
      mockFindUnique.mockResolvedValue({
        id: 503,
        workflowStatus: 'awaiting_question',
        updatedAt: new Date(),
      });
      mockReadWorkflowFile.mockResolvedValue(
        '```json:options\n' +
          JSON.stringify({
            questions: [
              {
                id: 'Q1',
                summary: '計画修正',
                options: [
                  { key: 'A', label: '計画修正', consequence: '計画へ反映', planRevision: true },
                ],
              },
            ],
          }) +
          '\n```',
      );
      mockTriggerReExecutionAfterAnswer.mockResolvedValue(result);
      const response = await handleAnswerWorkflowQuestion({
        params: { taskId: '503' },
        body: { answer: '計画を修正する', selections: [{ questionId: 'Q1', selectedKey: 'A' }] },
        set: {},
        headers: { 'x-rapitas-source': 'ui' },
      });
      expect(response).toMatchObject({
        ok: true,
        resolvedKind: 'plan_revision',
        toStatus: 'research_done',
      });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workflowStatus: 'research_done' }),
        }),
      );
      expect(mockPrisma.workflowTransition.create).toHaveBeenCalled();
      if (result === 'waiting_slot')
        expect(response).toMatchObject({
          waitingForSlot: true,
          message: expect.stringContaining('待機中'),
        });
      else expect(response).not.toHaveProperty('waitingForSlot');
    },
  );
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
      headers: { 'x-rapitas-source': 'ui' },
    });
    expect(result).toEqual({
      taskId: 503,
      ok: true,
      toStatus: 'draft',
      resolvedKind: 'spec_change',
    });
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
      headers: { 'x-rapitas-source': 'ui' },
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
      headers: { 'x-rapitas-source': 'ui' },
    });
    expect(mockArchiveWorkflowFile).toHaveBeenCalledWith(7, 'question');
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 7, toStatus: 'draft', cause: 'intake_question_answered' }),
    );
  });
  test('appends the answer to question.md content BEFORE archiving (audit trail)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 8,
      description: null,
      goals: null,
      workflowStatus: 'awaiting_question',
      status: 'todo',
    });
    mockReadWorkflowFile.mockResolvedValue('# 質問\n選択肢Aか選択肢Bか');
    await handleAnswerWorkflowQuestion({
      params: { taskId: '8' },
      body: { answer: '選択: Aで進める' },
      set: {},
      headers: { 'x-rapitas-source': 'ui' },
    });
    expect(mockReadWorkflowFile).toHaveBeenCalledWith(8, 'question');
    expect(mockWriteWorkflowFile).toHaveBeenCalledWith(
      8,
      'question',
      expect.stringContaining('選択: Aで進める'),
    );
    const writtenContent = mockWriteWorkflowFile.mock.calls[0][2] as string;
    expect(writtenContent).toContain('# 質問\n選択肢Aか選択肢Bか');
    expect(writtenContent).toContain('## 回答（ユーザー選択）');
    const writeOrder = mockWriteWorkflowFile.mock.invocationCallOrder[0];
    const archiveOrder = mockArchiveWorkflowFile.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(archiveOrder);
  });
  test('skips the append when question.md content is missing (nothing to append to)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 9,
      description: null,
      goals: null,
      workflowStatus: 'awaiting_question',
      status: 'todo',
    });
    mockReadWorkflowFile.mockResolvedValue(null);
    await handleAnswerWorkflowQuestion({
      params: { taskId: '9' },
      body: { answer: '回答' },
      set: {},
      headers: { 'x-rapitas-source': 'ui' },
    });
    expect(mockWriteWorkflowFile).not.toHaveBeenCalled();
    expect(mockArchiveWorkflowFile).toHaveBeenCalledWith(9, 'question');
  });
  test('records a structured-answer selections payload in transition metadata', async () => {
    mockFindUnique.mockResolvedValue({
      id: 10,
      description: null,
      goals: null,
      workflowStatus: 'awaiting_question',
      status: 'todo',
    });
    await handleAnswerWorkflowQuestion({
      params: { taskId: '10' },
      body: {
        answer: '## Q1: ゴール\n選択: 品質を優先する（影響: テストを手厚くする）',
        selections: [{ questionId: 'Q1', selectedKey: 'B' }],
      },
      set: {},
      headers: { 'x-rapitas-source': 'ui' },
    });
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 10,
        metadata: {
          selections: [{ questionId: 'Q1', selectedKey: 'B' }],
          kind: 'spec_change',
        },
      }),
    );
  });
  test('ignores a malformed selections payload without throwing (metadata stays empty)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 11,
      description: null,
      goals: null,
      workflowStatus: 'awaiting_question',
      status: 'todo',
    });
    await handleAnswerWorkflowQuestion({
      params: { taskId: '11' },
      body: { answer: '回答', selections: 'not-an-array' },
      set: {},
      headers: { 'x-rapitas-source': 'ui' },
    });
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 11, metadata: { kind: 'spec_change' } }),
    );
  });
  test('delegates the post-answer auto re-run to triggerReExecutionAfterAnswer', async () => {
    mockFindUnique.mockResolvedValue({
      id: 512,
      description: '既存の説明',
      goals: '[]',
      workflowStatus: 'awaiting_question',
      status: 'blocked',
    });
    const result = await handleAnswerWorkflowQuestion({
      params: { taskId: '512' },
      body: { answer: 'A: 本格ログインを必須にする' },
      set: {},
      headers: { 'x-rapitas-source': 'ui' },
    });
    expect(mockTriggerReExecutionAfterAnswer).toHaveBeenCalledWith(512);
    expect(result).toEqual({
      taskId: 512,
      ok: true,
      toStatus: 'draft',
      resolvedKind: 'spec_change',
    });
  });
  test('does not throw when triggerReExecutionAfterAnswer itself rejects', async () => {
    mockFindUnique.mockResolvedValue({
      id: 512,
      description: null,
      goals: null,
      workflowStatus: 'awaiting_question',
      status: 'blocked',
    });
    mockTriggerReExecutionAfterAnswer.mockRejectedValue(new Error('boom'));
    await expect(
      handleAnswerWorkflowQuestion({
        params: { taskId: '512' },
        body: { answer: '回答' },
        set: {},
        headers: { 'x-rapitas-source': 'ui' },
      }),
    ).rejects.toThrow('boom');
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
      handleAnswerWorkflowQuestion({
        params: { taskId: '1' },
        body: { answer: '   ' },
        set,
        headers: { 'x-rapitas-source': 'ui' },
      }),
    ).rejects.toThrow('answer is required');
    expect(set.status).toBe(400);
  });
  test('throws NotFoundError when the task does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const set: { status?: number } = {};
    await expect(
      handleAnswerWorkflowQuestion({
        params: { taskId: '999' },
        body: { answer: 'x' },
        set,
        headers: { 'x-rapitas-source': 'ui' },
      }),
    ).rejects.toThrow('Task not found');
    expect(set.status).toBe(404);
  });
  test('回答時に plan.md もアーカイブして計画を再生成させる', async () => {
    mockFindUnique.mockResolvedValue({
      id: 662,
      description: '元の説明',
      goals: '[]',
      workflowStatus: 'awaiting_question',
      status: 'todo',
    });
    await handleAnswerWorkflowQuestion({
      params: { taskId: '662' },
      body: { answer: 'UIカードを追加する' },
      set: {},
      headers: { 'x-rapitas-source': 'operator' },
    });
    const archived = mockArchiveWorkflowFile.mock.calls.map((c) => c[1]);
    expect(archived).toContain('question');
    expect(archived).toContain('plan');
  });
  describe('仕様質問への回答は発行元を要求する', () => {
    test('ヘッダ無しの呼び出しは拒否され、侵害として記録される', async () => {
      const set: { status?: number } = {};
      await expect(
        handleAnswerWorkflowQuestion({
          params: { taskId: '662' },
          body: { answer: 'UI追加なしで完了とする' },
          set,
        }),
      ).rejects.toThrow('X-Rapitas-Source');
      expect(set.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
      const call = mockRecordTransition.mock.calls[0]?.[0] as {
        cause: string;
        invariantViolation?: boolean;
      };
      expect(call.cause).toBe('spec_answer_blocked');
      expect(call.invariantViolation).toBe(true);
    });
    test('未知の発行元も拒否される', async () => {
      const set: { status?: number } = {};
      await expect(
        handleAnswerWorkflowQuestion({
          params: { taskId: '662' },
          body: { answer: 'x' },
          set,
          headers: { 'x-rapitas-source': 'agent' },
        }),
      ).rejects.toThrow('X-Rapitas-Source');
      expect(mockUpdate).not.toHaveBeenCalled();
    });
    test('オペレーター代理回答はその旨が記録される', async () => {
      mockFindUnique.mockResolvedValue({
        id: 662,
        description: '元の説明',
        goals: '[]',
        workflowStatus: 'awaiting_question',
        status: 'todo',
      });
      await handleAnswerWorkflowQuestion({
        params: { taskId: '662' },
        body: { answer: 'UIを追加する' },
        set: {},
        headers: { 'x-rapitas-source': 'operator' },
      });
      const data = mockUpdate.mock.calls[0]?.[0] as { data: { description: string } };
      expect(data.data.description).toContain('オペレーター代理回答');
      expect(data.data.description).not.toContain('ユーザー選択');
    });
  });
});
test('the actual answer handler holds lifecycle ownership until its persistence finishes', async () => {
  const { withTaskLifecycleLock } = await import('../../../services/workflow/task-lifecycle-lock');
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  mockFindUnique.mockResolvedValue({
    id: 503,
    description: '',
    goals: '[]',
    workflowStatus: 'awaiting_question',
    status: 'blocked',
  });
  mockUpdate.mockImplementationOnce(async () => {
    entered();
    await gate;
    return {};
  });
  const answer = handleAnswerWorkflowQuestion({
    params: { taskId: '503' },
    body: { answer: 'Resume design review' },
    set: {},
    headers: { 'x-rapitas-source': 'operator' },
  });
  let decisionEntered = false;
  let decision: Promise<void> | undefined;
  try {
    await started;
    decision = withTaskLifecycleLock(503, async () => {
      decisionEntered = true;
    });
    await withTaskLifecycleLock(504, async () => {});
    expect(decisionEntered).toBe(false);
    expect(mockRecordTransition).not.toHaveBeenCalled();
  } finally {
    release();
    await answer;
    await decision;
  }
  expect(decisionEntered).toBe(true);
  expect(mockRecordTransition).toHaveBeenCalledWith(
    expect.objectContaining({ cause: 'intake_question_answered' }),
  );
});
