/**
 * workflow-handlers-resume-plan-revision.test
 *
 * Covers the planner re-dispatch after a question answer routed to plan
 * revision (task 1310): persisting `research_done` alone left the task with no
 * agent and no queue item. Not responsible for the revision persistence itself
 * (workflow-handlers-resume-dispatch.test.ts).
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config', () => ({
  prisma: {},
  createLogger: () => noopLogger,
}));
mock.module('../../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  archiveWorkflowFile: mock(() => Promise.resolve()),
  readWorkflowFile: mock(() => Promise.resolve(null)),
  writeWorkflowFile: mock(() => Promise.resolve('')),
}));
mock.module('../../../services/workflow/task-lifecycle-lock', () => ({
  withTaskLifecycleLock: (_id: number, fn: () => unknown) => fn(),
}));

const applyMock = mock(() =>
  Promise.resolve({
    taskId: 7,
    ok: true as const,
    toStatus: 'research_done' as const,
    kind: 'plan_revision' as const,
  }),
);
mock.module('./workflow-handlers-resume-dispatch', () => ({
  applyQuestionAnswerByKind: applyMock,
}));

const redispatchMock = mock(() => Promise.resolve());
mock.module('./workflow-handlers-resume-redispatch', () => ({
  triggerReExecutionAfterAnswer: redispatchMock,
}));

mock.module('./workflow-handlers-resume-continuation', () => ({
  applyResumeFromQuestionAnswerLocked: mock(() => Promise.resolve()),
  applyResumeFromQuestionAnswer: mock(() => Promise.resolve()),
  handleResumeFromQuestion: mock(() => Promise.resolve()),
}));

const { handleAnswerWorkflowQuestion } = await import('./workflow-handlers-resume');

function call() {
  return handleAnswerWorkflowQuestion({
    params: { taskId: '7' },
    body: { answer: '計画を改訂する' },
    set: {},
    headers: { 'x-rapitas-source': 'ui' },
  });
}

beforeEach(() => {
  redispatchMock.mockReset().mockResolvedValue(undefined);
  applyMock.mockReset().mockResolvedValue({
    taskId: 7,
    ok: true,
    toStatus: 'research_done',
    kind: 'plan_revision',
  });
});

describe('handleAnswerWorkflowQuestion plan revision re-dispatch', () => {
  test('[計画改訂] 回答経由で planner 再起動が呼ばれる', async () => {
    const res = await call();
    expect(res.resolvedKind).toBe('plan_revision');
    expect(redispatchMock).toHaveBeenCalledTimes(1);
    expect(redispatchMock).toHaveBeenCalledWith(7);
  });

  test('plan_revision 以外の kind では呼ばない', async () => {
    applyMock.mockResolvedValue({
      taskId: 7,
      ok: true,
      toStatus: 'plan_approved',
      kind: 'execution_continuation',
    } as never);
    await call();
    expect(redispatchMock).not.toHaveBeenCalled();
  });
});
