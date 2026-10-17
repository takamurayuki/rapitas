/**
 * workflow-reconciler-question-auto-answer-plan-revision.test
 *
 * Covers the planner re-dispatch after a timeout auto-adoption routed to plan
 * revision (task 1310). Not responsible for the timeout/eligibility rules
 * (workflow-reconciler-question-auto-answer.test.ts).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const NOW_MS = 1_800_000_000_000;
const ONE_HOUR_MS = 60 * 60 * 1000;

const QUESTION_MD =
  '```json:options\n' +
  JSON.stringify({
    questions: [
      {
        id: 'Q1',
        summary: '完了条件が達成不能',
        options: [{ key: 'A', label: '計画を改訂する', planRevision: true }],
        freeTextRequired: false,
        recommended: 'A',
        recommendedReason: '実装者に禁止された操作を要求しているため',
      },
    ],
  }) +
  '\n```';

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findMany: () =>
        Promise.resolve([
          { id: 1, title: 't', status: 'todo', workflowStatus: 'awaiting_question' },
        ]),
    },
    workflowFile: {
      findFirst: () =>
        Promise.resolve({
          content: QUESTION_MD,
          updatedAt: new Date(NOW_MS - ONE_HOUR_MS - 60_000),
        }),
    },
    workflowTransition: {
      findFirst: (args: { where?: { toStatus?: string; metadata?: unknown } }) => {
        if (args?.where?.metadata) return Promise.resolve(null);
        if (args?.where?.toStatus === 'awaiting_question')
          return Promise.resolve({ cause: 'file_saved:question' });
        return Promise.resolve({ createdAt: new Date(NOW_MS - ONE_HOUR_MS - 60_000) });
      },
    },
    themeAutoRun: { findUnique: () => Promise.resolve({ enabled: true }) },
  },
  ensureDatabaseConnection: async () => {},
}));
mock.module('./workflow-file-utils', () => ({ writeWorkflowFile: () => Promise.resolve('') }));
mock.module('../communication/notification-service', () => ({
  notifyQuestionAutoAnswered: () => Promise.resolve(),
}));
mock.module('./question-auto-answer-override-gate', () => ({
  resolveHumanOverrideHold: () => Promise.resolve({ hold: false }),
}));

const applyMock = mock(() =>
  Promise.resolve({
    taskId: 1,
    ok: true as const,
    toStatus: 'research_done' as const,
    kind: 'plan_revision' as const,
  }),
);
mock.module('../../routes/workflow/handlers/workflow-handlers-resume-dispatch', () => ({
  applyQuestionAnswerByKind: applyMock,
}));

const redispatchMock = mock(() => Promise.resolve());
mock.module('../../routes/workflow/handlers/workflow-handlers-resume-redispatch', () => ({
  triggerReExecutionAfterAnswer: redispatchMock,
}));

const { healStaleQuestionAutoAnswer } = await import('./workflow-reconciler-question-auto-answer');

beforeEach(() => {
  redispatchMock.mockReset().mockResolvedValue(undefined);
  applyMock.mockReset().mockResolvedValue({
    taskId: 1,
    ok: true,
    toStatus: 'research_done',
    kind: 'plan_revision',
  });
});

describe('healStaleQuestionAutoAnswer plan revision re-dispatch', () => {
  test('[計画改訂] 無応答自動採用でも再起動が1回だけ呼ばれる', async () => {
    const res = await healStaleQuestionAutoAnswer(new Date(NOW_MS));
    expect(res.autoAnswered).toBe(1);
    expect(redispatchMock).toHaveBeenCalledTimes(1);
    expect(redispatchMock).toHaveBeenCalledWith(1);
  });

  test('plan_revision 以外の kind では呼ばない', async () => {
    applyMock.mockResolvedValue({
      taskId: 1,
      ok: true,
      toStatus: 'plan_approved',
      kind: 'execution_continuation',
    } as never);
    await healStaleQuestionAutoAnswer(new Date(NOW_MS));
    expect(redispatchMock).not.toHaveBeenCalled();
  });

  test('再起動が reject しても自動採用は成功のまま', async () => {
    redispatchMock.mockRejectedValue(new Error('boom'));
    const res = await healStaleQuestionAutoAnswer(new Date(NOW_MS));
    expect(res.autoAnswered).toBe(1);
  });
});
