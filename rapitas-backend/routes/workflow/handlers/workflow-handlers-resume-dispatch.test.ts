/**
 * workflow-handlers-resume-dispatch.test
 *
 * Covers applyQuestionAnswerByKind: kind resolution (recorded vs derived vs
 * explicit-in-metadata), strategy routing to the intake/resume appliers, and
 * the three competing-answer conflict guards (task_stopping, question_outdated,
 * question_already_answered).
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

const mockReadWorkflowFile = mock((..._args: unknown[]) => Promise.resolve<string | null>(null));
const mockWriteWorkflowFile = mock((..._args: unknown[]) => Promise.resolve(''));
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  readWorkflowFile: mockReadWorkflowFile,
  writeWorkflowFile: mockWriteWorkflowFile,
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
const mockApplyCriteriaReviewSelection = mock(() => Promise.resolve(true));
mock.module('../../../services/workflow/research-criteria-review', () => ({
  applyCriteriaReviewSelection: mockApplyCriteriaReviewSelection,
}));
mock.module('./workflow-handlers-resume', () => ({
  applyIntakeQuestionAnswerLocked: mockApplyIntakeQuestionAnswerLocked,
}));

const mockApplyResumeFromQuestionAnswerLocked = mock(() =>
  Promise.resolve({
    taskId: 1,
    fromStatus: 'awaiting_question' as const,
    toStatus: 'in_progress' as const,
    source: 'transition_metadata' as const,
  }),
);
mock.module('./workflow-handlers-resume-continuation', () => ({
  applyResumeFromQuestionAnswerLocked: mockApplyResumeFromQuestionAnswerLocked,
}));

const { applyQuestionAnswerByKind } = await import('./workflow-handlers-resume-dispatch');

const BASE_PARAMS = {
  taskId: 1,
  answer: '回答本文',
  actor: 'user' as const,
  sourceLabel: 'ユーザー選択',
};

beforeEach(() => {
  mockFindFirstTransition.mockReset();
  mockUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  mockTaskFindUnique.mockReset().mockResolvedValue({
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    workflowStatus: 'awaiting_question',
  });
  mockTaskUpdate.mockReset().mockResolvedValue({});
  mockCreateTransition.mockReset().mockResolvedValue(undefined);
  mockReadWorkflowFile.mockReset().mockResolvedValue(null);
  mockWriteWorkflowFile.mockReset().mockResolvedValue('');
  mockIsLatestExecutionCancelled.mockReset().mockResolvedValue(false);
  mockApplyIntakeQuestionAnswerLocked
    .mockReset()
    .mockResolvedValue({ taskId: 1, ok: true, toStatus: 'draft' });
  mockApplyResumeFromQuestionAnswerLocked.mockReset().mockResolvedValue({
    taskId: 1,
    fromStatus: 'awaiting_question',
    toStatus: 'in_progress',
    source: 'transition_metadata',
  });
});

describe('applyQuestionAnswerByKind — kind resolution and routing', () => {
  test('cause=intake_question resolves spec_change and calls applyIntakeQuestionAnswerLocked', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 1,
      cause: 'intake_question',
      fromStatus: 'draft',
      metadata: {},
    });

    const result = await applyQuestionAnswerByKind(BASE_PARAMS);

    expect(result.kind).toBe('spec_change');
    expect(mockApplyIntakeQuestionAnswerLocked).toHaveBeenCalledTimes(1);
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
    const call = mockApplyIntakeQuestionAnswerLocked.mock.calls[0][0] as { extraMetadata?: object };
    expect(call.extraMetadata).toEqual({ kind: 'spec_change' });
  });

  test('cause=file_saved:question with previousStatus!=verify_done resolves execution_continuation, recheckCompletionGate=false', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 2,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });

    const result = await applyQuestionAnswerByKind(BASE_PARAMS);

    expect(result.kind).toBe('execution_continuation');
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalledTimes(1);
    expect(mockApplyIntakeQuestionAnswerLocked).not.toHaveBeenCalled();
    const call = mockApplyResumeFromQuestionAnswerLocked.mock.calls[0][0] as {
      recheckCompletionGate?: boolean;
      answer?: string;
    };
    expect(call.recheckCompletionGate).toBe(false);
    expect(call.answer).toBe('回答本文');
  });

  test('cause=file_saved:question with previousStatus=verify_done resolves completion_confirmation, recheckCompletionGate=true', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 3,
      cause: 'file_saved:question',
      fromStatus: 'verify_done',
      metadata: { previousStatus: 'verify_done' },
    });

    const result = await applyQuestionAnswerByKind(BASE_PARAMS);

    expect(result.kind).toBe('completion_confirmation');
    const call = mockApplyResumeFromQuestionAnswerLocked.mock.calls[0][0] as {
      recheckCompletionGate?: boolean;
    };
    expect(call.recheckCompletionGate).toBe(true);
  });

  test('an explicit kind recorded in metadata is honored over the derived default', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 4,
      cause: 'file_saved:question',
      fromStatus: 'verify_done',
      metadata: JSON.stringify({ previousStatus: 'verify_done', kind: 'execution_continuation' }),
    });

    const result = await applyQuestionAnswerByKind(BASE_PARAMS);

    expect(result.kind).toBe('execution_continuation');
  });
});

// task 902 (revised plan): resume-from-question calls this with no answer
// body. execution_continuation/completion_confirmation must accept that;
// spec_change must not silently treat an unconfirmed change as answered.
describe('applyQuestionAnswerByKind — answer is optional except for spec_change', () => {
  test('execution_continuation succeeds with no answer provided', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 5,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });

    const result = await applyQuestionAnswerByKind({
      taskId: 1,
      actor: 'user',
    });

    expect(result.kind).toBe('execution_continuation');
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalledTimes(1);
    const call = mockApplyResumeFromQuestionAnswerLocked.mock.calls[0][0] as { answer?: string };
    expect(call.answer).toBeUndefined();
  });

  test('completion_confirmation succeeds with no answer provided', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 6,
      cause: 'file_saved:question',
      fromStatus: 'verify_done',
      metadata: { previousStatus: 'verify_done' },
    });

    const result = await applyQuestionAnswerByKind({
      taskId: 1,
      actor: 'user',
    });

    expect(result.kind).toBe('completion_confirmation');
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalledTimes(1);
  });

  test('spec_change with no answer is rejected with a ValidationError and applies no state change', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 7,
      cause: 'intake_question',
      fromStatus: 'draft',
      metadata: {},
    });

    await expect(applyQuestionAnswerByKind({ taskId: 1, actor: 'user' })).rejects.toThrow(
      '回答本文なしでは処理できません',
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockApplyIntakeQuestionAnswerLocked).not.toHaveBeenCalled();
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('spec_change with an empty-string answer is rejected the same as no answer', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 8,
      cause: 'intake_question',
      fromStatus: 'draft',
      metadata: {},
    });

    await expect(
      applyQuestionAnswerByKind({ taskId: 1, actor: 'user', answer: '' }),
    ).rejects.toThrow('回答本文なしでは処理できません');
    expect(mockApplyIntakeQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('an existing required-answer call (auto-answer heal pass shape) still works unchanged', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 9,
      cause: 'intake_question',
      fromStatus: 'draft',
      metadata: {},
    });

    const result = await applyQuestionAnswerByKind(BASE_PARAMS);

    expect(result.kind).toBe('spec_change');
    expect(mockApplyIntakeQuestionAnswerLocked).toHaveBeenCalledTimes(1);
  });
});

describe('applyQuestionAnswerByKind — conflict guards', () => {
  test('throws NotFoundError when no awaiting_question transition is on record', async () => {
    mockFindFirstTransition.mockResolvedValue(null);

    await expect(applyQuestionAnswerByKind(BASE_PARAMS)).rejects.toThrow(
      'No pending question found',
    );
    expect(mockApplyIntakeQuestionAnswerLocked).not.toHaveBeenCalled();
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('task_stopping: rejects and applies no state change when the latest execution is cancelled', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 1,
      cause: 'intake_question',
      fromStatus: 'draft',
      metadata: {},
    });
    mockIsLatestExecutionCancelled.mockResolvedValue(true);

    await expect(applyQuestionAnswerByKind(BASE_PARAMS)).rejects.toThrow(
      'タスクの実行が停止されています',
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockApplyIntakeQuestionAnswerLocked).not.toHaveBeenCalled();
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('question_outdated: rejects when a newer awaiting_question pause has superseded the captured one', async () => {
    let call = 0;
    mockFindFirstTransition.mockImplementation(() => {
      call++;
      // First call ("target") returns id=1; second call (staleness re-check)
      // returns a NEWER pause (id=2) — simulating a heal-pass re-pause that
      // landed between the two reads.
      if (call === 1) {
        return Promise.resolve({
          id: 1,
          cause: 'intake_question',
          fromStatus: 'draft',
          metadata: {},
        });
      }
      return Promise.resolve({ id: 2 });
    });

    await expect(applyQuestionAnswerByKind(BASE_PARAMS)).rejects.toThrow(
      'この質問は既に別の質問に置き換わっています',
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockApplyIntakeQuestionAnswerLocked).not.toHaveBeenCalled();
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('question_already_answered: rejects when the CAS touch finds 0 rows (a concurrent answer already landed)', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 1,
      cause: 'intake_question',
      fromStatus: 'draft',
      metadata: {},
    });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    await expect(applyQuestionAnswerByKind(BASE_PARAMS)).rejects.toThrow(
      'この質問は既に回答済みです',
    );
    expect(mockApplyIntakeQuestionAnswerLocked).not.toHaveBeenCalled();
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });
});

// task 933: an option flagged planRevision:true routes to a plan.md revision
// request instead of resuming the implementer.
function questionMdWithPlanRevisionOption(): string {
  return (
    '# 実装フェーズからの質問\n\n' +
    '```json:options\n' +
    JSON.stringify({
      questions: [
        {
          id: 'Q1',
          summary: '完了条件が実装者の権限で達成不能',
          options: [
            { key: 'A', label: 'このまま実測を続ける', consequence: '実測を継続' },
            {
              key: 'B',
              label: '計画を改訂する',
              consequence: '完了条件を静的検証に変更',
              planRevision: true,
            },
          ],
          freeTextRequired: false,
          recommended: 'B',
          recommendedReason: '実装者に禁止された操作を要求しているため',
        },
      ],
    }) +
    '\n```'
  );
}

describe('applyQuestionAnswerByKind — planRevision routing (task 933)', () => {
  test('a human answer selecting a planRevision option routes to research_done without resuming', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 10,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });
    mockReadWorkflowFile.mockResolvedValue(questionMdWithPlanRevisionOption());

    const result = await applyQuestionAnswerByKind({
      taskId: 1,
      answer: '静的検証への切り替えに同意します',
      actor: 'user',
      sourceLabel: 'ユーザー選択',
      selections: [{ questionId: 'Q1', selectedKey: 'B' }],
    });

    expect(result).toEqual({
      taskId: 1,
      ok: true,
      toStatus: 'research_done',
      kind: 'plan_revision',
    });
    expect(mockApplyIntakeQuestionAnswerLocked).not.toHaveBeenCalled();
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();

    expect(mockTaskUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mockTaskUpdate.mock.calls[0][0] as {
      where: { workflowStatus: string };
      data: { workflowStatus: string };
    };
    expect(updateCall.data.workflowStatus).toBe('research_done');

    expect(mockCreateTransition).toHaveBeenCalledTimes(1);
    const transitionCall = mockCreateTransition.mock.calls[0][0] as {
      data: { cause: string; metadata: string };
    };
    expect(transitionCall.data.cause).toBe('plan_revision_requested');
    const metadata = JSON.parse(transitionCall.data.metadata) as {
      instruction: string;
      source: string;
    };
    expect(metadata.source).toBe('ユーザー');
    expect(metadata.instruction).toContain('完了条件が実装者の権限で達成不能');
    expect(metadata.instruction).toContain('計画を改訂する');
    expect(metadata.instruction).toContain('完了条件を静的検証に変更');
    expect(metadata.instruction).toContain('静的検証への切り替えに同意します');
  });

  test('an operator answer maps sourceLabel to オペレーター', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 11,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });
    mockReadWorkflowFile.mockResolvedValue(questionMdWithPlanRevisionOption());

    await applyQuestionAnswerByKind({
      taskId: 1,
      answer: '改訂して',
      actor: 'user',
      sourceLabel: 'オペレーター代理回答',
      selections: [{ questionId: 'Q1', selectedKey: 'B' }],
    });

    const metadata = JSON.parse(
      (mockCreateTransition.mock.calls[0][0] as { data: { metadata: string } }).data.metadata,
    ) as { source: string };
    expect(metadata.source).toBe('オペレーター');
  });

  test('the auto_recommended path (no answer body) maps sourceLabel to システム（自動採用）', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 12,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });
    mockReadWorkflowFile.mockResolvedValue(questionMdWithPlanRevisionOption());

    const result = await applyQuestionAnswerByKind({
      taskId: 1,
      actor: 'system',
      sourceLabel: '推奨案の自動採用（無応答タイムアウト）',
      selections: [{ questionId: 'Q1', selectedKey: 'B' }],
      extraMetadata: { reason: 'auto_recommended' },
    });

    expect(result.kind).toBe('plan_revision');
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
    const metadata = JSON.parse(
      (mockCreateTransition.mock.calls[0][0] as { data: { metadata: string } }).data.metadata,
    ) as { source: string; instruction: string };
    expect(metadata.source).toBe('システム（自動採用）');
    expect(metadata.instruction).toContain('回答本文: なし');
  });

  test('a selection naming an option WITHOUT planRevision falls through to normal resume routing', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 13,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });
    mockReadWorkflowFile.mockResolvedValue(questionMdWithPlanRevisionOption());

    const result = await applyQuestionAnswerByKind({
      taskId: 1,
      answer: '実測を続けます',
      actor: 'user',
      sourceLabel: 'ユーザー選択',
      selections: [{ questionId: 'Q1', selectedKey: 'A' }],
    });

    expect(result.kind).toBe('execution_continuation');
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalledTimes(1);
    expect(mockCreateTransition).not.toHaveBeenCalled();
  });

  test('a flag-less question (no json:options block) is unaffected — falls through to normal resume', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 14,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });
    mockReadWorkflowFile.mockResolvedValue('# 自由記述の質問です（json:optionsブロックなし）');

    const result = await applyQuestionAnswerByKind(BASE_PARAMS);

    expect(result.kind).toBe('execution_continuation');
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalledTimes(1);
    expect(mockCreateTransition).not.toHaveBeenCalled();
  });

  test('旧来の再開 API はファイル許可のない質問を以前の状態へ戻す', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 15,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });
    mockReadWorkflowFile.mockResolvedValue(questionMdWithPlanRevisionOption());

    const result = await applyQuestionAnswerByKind({ taskId: 1, actor: 'user' });

    expect(result.kind).toBe('execution_continuation');
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalledTimes(1);
    expect(mockCreateTransition).not.toHaveBeenCalled();
  });

  test('旧改訂フラグでも改訂保存の失敗を返して質問待ちを維持する', async () => {
    mockFindFirstTransition.mockResolvedValue({
      id: 16,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });
    mockReadWorkflowFile.mockResolvedValue(questionMdWithPlanRevisionOption());
    mockTaskUpdate.mockRejectedValueOnce(new Error('CAS 0 rows'));

    await expect(
      applyQuestionAnswerByKind({
        taskId: 1,
        answer: '改訂して',
        actor: 'user',
        sourceLabel: 'ユーザー選択',
        selections: [{ questionId: 'Q1', selectedKey: 'B' }],
      }),
    ).rejects.toThrow('CAS 0 rows');
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
    expect(mockCreateTransition).not.toHaveBeenCalled();
  });
});

// Asked 2026-11-20: the criteria question now offers 「推奨の完了条件に書き換える」.
// The choice must reach the criteria before the task resumes at research_done
// — answered after the resume, the planner would read the old criteria.
describe('applyQuestionAnswerByKind — criteria review question', () => {
  test('hands the choice to the criteria review before resuming', async () => {
    mockApplyCriteriaReviewSelection.mockClear();
    const meta = {
      previousStatus: 'research_done',
      kind: 'execution_continuation',
      proposedCriteria: ['変更前に通っていたテストが変更後も通る'],
    };
    mockFindFirstTransition.mockResolvedValue({
      id: 11,
      cause: 'criteria_review_question',
      fromStatus: 'research_done',
      metadata: meta,
    });
    mockReadWorkflowFile.mockResolvedValue('# 仕様確認');
    const selections = [{ questionId: 'criteria', selectedKey: 'adopt' }];
    await applyQuestionAnswerByKind({ taskId: 1, actor: 'user', selections });
    expect(mockApplyCriteriaReviewSelection).toHaveBeenCalledTimes(1);
    expect(mockApplyCriteriaReviewSelection.mock.calls[0]).toEqual([1, meta, selections]);
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalled();
  });

  test('leaves other questions alone', async () => {
    mockApplyCriteriaReviewSelection.mockClear();
    mockFindFirstTransition.mockResolvedValue({
      id: 12,
      cause: 'file_saved:question',
      fromStatus: 'in_progress',
      metadata: { previousStatus: 'in_progress' },
    });
    mockReadWorkflowFile.mockResolvedValue('# 質問');
    await applyQuestionAnswerByKind({
      taskId: 1,
      actor: 'user',
      selections: [{ questionId: 'criteria', selectedKey: 'adopt' }],
    });
    expect(mockApplyCriteriaReviewSelection).not.toHaveBeenCalled();
  });
});

// task 1546: answers that leave the plan alone resume the implementer.
function questionMd(option: Record<string, unknown>): string {
  return (
    '# 質問\n\n```json:options\n' +
    JSON.stringify({
      questions: [
        {
          id: 'Q1',
          summary: '実装の進め方',
          options: [{ key: 'A', label: '選択する', ...option }],
          freeTextRequired: false,
          recommended: 'A',
          recommendedReason: '根拠',
        },
      ],
    }) +
    '\n```'
  );
}

function arrangePause(question: string): void {
  mockFindFirstTransition.mockResolvedValue({
    id: 20,
    cause: 'file_saved:question',
    fromStatus: 'in_progress',
    metadata: { previousStatus: 'in_progress' },
  });
  mockReadWorkflowFile.mockResolvedValue(question);
}

const SEL = [{ questionId: 'Q1', selectedKey: 'A' }];
const HUMAN = {
  taskId: 1,
  answer: '許可します',
  actor: 'user' as const,
  sourceLabel: 'ユーザー選択',
  selections: SEL,
};

function resumeMetadata(): Record<string, unknown> {
  const call = mockApplyResumeFromQuestionAnswerLocked.mock.calls[0][0] as {
    extraMetadata: Record<string, unknown>;
  };
  return call.extraMetadata;
}

describe('回答による計画改訂と実装再開 (task 1546)', () => {
  test.each([
    ['旧フラグ付きの明示分類', { planRevision: true, planImpact: 'none' }, SEL],
    ['無印の選択肢', {}, SEL],
    ['自由記述', { planRevision: true }, undefined],
    ['該当する選択肢なし', { planRevision: true }, [{ questionId: 'Q1', selectedKey: 'Z' }]],
  ] as const)('計画内の回答（%s）を引き継いで実装を再開する', async (_, option, selections) => {
    arrangePause(questionMd(option));

    const result = await applyQuestionAnswerByKind({
      ...HUMAN,
      selections: selections && [...selections],
      extraMetadata: { routing: 'revision', routingReason: 'criteria_change' },
    });

    expect(result).toMatchObject({ kind: 'execution_continuation', toStatus: 'in_progress' });
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalledTimes(1);
    expect(mockApplyResumeFromQuestionAnswerLocked).toHaveBeenCalledWith(
      expect.objectContaining({ answer: HUMAN.answer, actor: 'user' }),
    );
    expect(mockCreateTransition).not.toHaveBeenCalled();
    expect(mockWriteWorkflowFile).not.toHaveBeenCalled();
    expect(resumeMetadata()).toMatchObject({ routing: 'resume', routingReason: 'no_plan_change' });
  });

  test.each([{ planImpact: 'criteria' }, { planRevision: true }, { planImpact: 'approach' }])(
    '改訂必須の選択では遷移の保存が失敗しても再開しない (%j)',
    async (option) => {
      arrangePause(questionMd(option));
      mockCreateTransition.mockRejectedValueOnce(new Error('遷移の保存失敗'));

      await expect(applyQuestionAnswerByKind(HUMAN)).rejects.toThrow('遷移の保存失敗');
      expect(mockWriteWorkflowFile).not.toHaveBeenCalled();
      expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
      expect(mockApplyIntakeQuestionAnswerLocked).not.toHaveBeenCalled();
    },
  );

  test('改訂必須の選択で更新競合が起きたら既存の競合として扱う', async () => {
    arrangePause(questionMd({ planImpact: 'approach' }));
    mockTaskUpdate.mockRejectedValueOnce(Object.assign(new Error('CAS 0 rows'), { code: 'P2025' }));

    await expect(applyQuestionAnswerByKind(HUMAN)).rejects.toMatchObject({
      code: 'question_already_answered',
    });
    expect(mockCreateTransition).not.toHaveBeenCalled();
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('旧フラグでも別の回答が先に確定したら実装を再開しない', async () => {
    arrangePause(questionMd({ planRevision: true }));
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(applyQuestionAnswerByKind(HUMAN)).rejects.toMatchObject({
      code: 'question_already_answered',
    });
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
    expect(mockCreateTransition).not.toHaveBeenCalled();
  });

  test('選択肢の読み取り中に質問が変われば旧回答を確定しない', async () => {
    arrangePause(questionMd({ planImpact: 'none' }));
    mockReadWorkflowFile.mockImplementationOnce(() => {
      mockFindFirstTransition.mockResolvedValue({ id: 21 });
      return Promise.resolve(questionMd({ planImpact: 'none' }));
    });

    await expect(applyQuestionAnswerByKind(HUMAN)).rejects.toMatchObject({
      code: 'question_outdated',
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
    expect(mockCreateTransition).not.toHaveBeenCalled();
  });

  test('旧形式の選択肢が先でも、明示的な方針変更があれば保存失敗時に再開しない', async () => {
    const question =
      '```json:options\n' +
      JSON.stringify({
        questions: [
          {
            id: 'Q1',
            summary: '旧形式',
            options: [{ key: 'A', label: '改訂', planRevision: true }],
          },
          {
            id: 'Q2',
            summary: '新形式',
            options: [{ key: 'A', label: '方針変更', planImpact: 'approach' }],
          },
        ],
      }) +
      '\n```';
    arrangePause(question);
    mockCreateTransition.mockRejectedValueOnce(new Error('遷移の保存失敗'));

    await expect(
      applyQuestionAnswerByKind({
        ...HUMAN,
        selections: [...SEL, { questionId: 'Q2', selectedKey: 'A' }],
      }),
    ).rejects.toThrow('遷移の保存失敗');
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('完了条件と実装詳細を同時に選ぶと完了条件と回答本文を改訂指示へ渡す', async () => {
    const question =
      '```json:options\n' +
      JSON.stringify({
        questions: [
          {
            id: 'Q1',
            summary: '完了条件',
            options: [{ key: 'A', label: '条件を変更', planImpact: 'criteria' }],
          },
          {
            id: 'Q2',
            summary: '実装詳細',
            options: [
              {
                key: 'A',
                label: '既存のフィクスチャを使う',
                planImpact: 'none',
              },
            ],
          },
        ],
      }) +
      '\n```';
    arrangePause(question);
    await applyQuestionAnswerByKind({
      ...HUMAN,
      selections: [...SEL, { questionId: 'Q2', selectedKey: 'A' }],
    });

    const transition = mockCreateTransition.mock.calls[0][0] as { data: { metadata: string } };
    const metadata = JSON.parse(transition.data.metadata);
    expect(metadata.routingReason).toBe('criteria_change');
    expect(metadata.instruction).toContain('条件を変更');
    expect(metadata.instruction).toContain(HUMAN.answer);
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
  });

  test('a criteria option still routes to plan revision and records why', async () => {
    arrangePause(questionMd({ planImpact: 'criteria' }));

    const result = await applyQuestionAnswerByKind(HUMAN);

    expect(result.kind).toBe('plan_revision');
    expect(mockApplyResumeFromQuestionAnswerLocked).not.toHaveBeenCalled();
    const t = mockCreateTransition.mock.calls[0][0] as {
      data: { cause: string; metadata: string };
    };
    expect(t.data.cause).toBe('plan_revision_requested');
    expect(JSON.parse(t.data.metadata)).toMatchObject({
      routing: 'revision',
      routingReason: 'criteria_change',
    });
  });

  test('resumeImplementer resumes a planRevision option for a human', async () => {
    arrangePause(questionMd({ planRevision: true }));

    const result = await applyQuestionAnswerByKind({ ...HUMAN, resumeImplementer: true });

    expect(result.kind).not.toBe('plan_revision');
    expect(resumeMetadata()).toMatchObject({
      routing: 'resume',
      routingReason: 'operator_resume_implementer',
    });
  });

  test('resumeImplementer cannot override a criteria change, nor be used by a system answer', async () => {
    arrangePause(questionMd({ planImpact: 'criteria' }));
    const criteria = await applyQuestionAnswerByKind({ ...HUMAN, resumeImplementer: true });
    expect(criteria.kind).toBe('plan_revision');
    expect(
      JSON.parse(
        (mockCreateTransition.mock.calls[0][0] as { data: { metadata: string } }).data.metadata,
      ),
    ).toMatchObject({ routingReason: 'criteria_not_overridable' });

    mockCreateTransition.mockClear();
    arrangePause(questionMd({ planRevision: true }));
    const system = await applyQuestionAnswerByKind({
      ...HUMAN,
      actor: 'system',
      sourceLabel: '推奨案の自動採用（無応答タイムアウト）',
      resumeImplementer: true,
    });
    expect(system.kind).toBe('plan_revision');
  });
});
