/**
 * plan-question-auto-adopt tests
 *
 * The recommended options go through the human answer path, and a plan
 * revision is re-dispatched.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

let questionContent: string | null = null;
mock.module('../../../../config', () => ({
  prisma: {
    workflowFile: {
      findFirst: () =>
        Promise.resolve(questionContent === null ? null : { content: questionContent }),
    },
  },
}));
const mockWrite = mock(() => Promise.resolve());
mock.module('../../../../services/workflow/workflow-file-utils', () => ({
  writeWorkflowFile: mockWrite,
}));
let appliedKind = 'execution_continuation';
const mockApply = mock(() =>
  Promise.resolve({ taskId: 1347, ok: true, toStatus: 'plan_approved', kind: appliedKind }),
);
mock.module('../workflow-handlers-resume-dispatch', () => ({
  applyQuestionAnswerByKind: mockApply,
}));
const mockRedispatch = mock(() => Promise.resolve());
mock.module('../workflow-handlers-resume-redispatch', () => ({
  triggerReExecutionAfterAnswer: mockRedispatch,
}));

const { adoptRecommendedAnswer } = await import('./plan-question-auto-adopt');

function questionMd(option: Record<string, unknown> = {}): string {
  const block = {
    kind: 'execution_continuation',
    questions: [
      {
        id: 'Q1',
        summary: 'INVALID_DRILL_SESSION を ErrorCode に足すか',
        options: [
          { key: 'A', label: 'errors.ts に 1 行足す', ...option },
          { key: 'B', label: '既存コードを流用する' },
        ],
        freeTextRequired: false,
        freeTextReason: null,
        recommended: 'A',
        recommendedReason: '応答仕様どおりになる',
      },
    ],
  };
  return `# 実装フェーズからの質問\n\n\`\`\`json:options\n${JSON.stringify(block)}\n\`\`\`\n`;
}

beforeEach(() => {
  questionContent = null;
  appliedKind = 'execution_continuation';
  mockWrite.mockClear();
  mockApply.mockClear();
  mockRedispatch.mockClear();
});

describe('adoptRecommendedAnswer', () => {
  test('answers with the recommended key as the system, noting it in question.md', async () => {
    questionContent = questionMd();
    expect(await adoptRecommendedAnswer(1347)).toBe(true);
    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1347,
        actor: 'system',
        selections: [{ questionId: 'Q1', selectedKey: 'A' }],
      }),
    );
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockRedispatch).not.toHaveBeenCalled();
  });

  test('re-dispatches when the adopted option routes to a plan revision', async () => {
    questionContent = questionMd({ planRevision: true });
    appliedKind = 'plan_revision';
    await adoptRecommendedAnswer(1347);
    expect(mockRedispatch).toHaveBeenCalledWith(1347);
  });

  test('leaves a question whose recommendation became unsafe to a human', async () => {
    questionContent = questionMd({ mutatesGate: true });
    expect(await adoptRecommendedAnswer(1347)).toBe(false);
    expect(mockApply).not.toHaveBeenCalled();
  });

  test('does nothing when question.md is gone', async () => {
    expect(await adoptRecommendedAnswer(1347)).toBe(false);
    expect(mockApply).not.toHaveBeenCalled();
  });
});
