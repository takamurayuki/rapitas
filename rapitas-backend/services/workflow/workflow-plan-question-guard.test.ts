/**
 * workflow-plan-question-guard テスト
 *
 * checkPlanQuestionBudget/blockPlanQuestionOverBudget のカウント・fail-closed・
 * fromStatus フィルタ・環境変数上書き・上限到達時の副作用を検証する。
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const countMock = mock(() => Promise.resolve(0));
const mockPrisma = {
  workflowTransition: {
    count: countMock,
  },
};

mock.module('../../config', () => ({
  prisma: mockPrisma,
}));

const writeBlockedStatusDurableMock = mock(() => Promise.resolve(true));
mock.module('./durable-blocked-write', () => ({
  writeBlockedStatusDurable: writeBlockedStatusDurableMock,
}));

const recordTransitionMock = mock(() => Promise.resolve());
mock.module('./transition-recorder', () => ({
  recordTransition: recordTransitionMock,
}));

const createNotificationMock = mock(() => Promise.resolve({}));
mock.module('../communication/notification-service', () => ({
  createNotification: createNotificationMock,
}));

const { checkPlanQuestionBudget, blockPlanQuestionOverBudget } =
  await import('./workflow-plan-question-guard');

describe('checkPlanQuestionBudget', () => {
  beforeEach(() => {
    countMock.mockReset();
  });

  afterEach(() => {
    delete process.env.RAPITAS_MAX_PLAN_QUESTION_ROUNDS;
  });

  test.each([0, 1, 2])('count=%i (below default limit 3) is allowed', async (count) => {
    countMock.mockResolvedValueOnce(count);
    const result = await checkPlanQuestionBudget(42);
    expect(result).toEqual({ allowed: true, count, limit: 3 });
  });

  test.each([3, 4])('count=%i (at/above default limit 3) is not allowed', async (count) => {
    countMock.mockResolvedValueOnce(count);
    const result = await checkPlanQuestionBudget(42);
    expect(result).toEqual({ allowed: false, count, limit: 3 });
  });

  test('a DB error is treated as exhausted (fail-closed)', async () => {
    countMock.mockRejectedValueOnce(new Error('db down'));
    const result = await checkPlanQuestionBudget(42);
    expect(result).toEqual({ allowed: false, count: 3, limit: 3 });
  });

  test('queries by cause + fromStatus, not by phase', async () => {
    countMock.mockResolvedValueOnce(0);
    await checkPlanQuestionBudget(42);
    expect(countMock).toHaveBeenCalledWith({
      where: { taskId: 42, cause: 'file_saved:question', fromStatus: 'plan_approved' },
    });
  });

  test('RAPITAS_MAX_PLAN_QUESTION_ROUNDS overrides the default limit', async () => {
    process.env.RAPITAS_MAX_PLAN_QUESTION_ROUNDS = '5';
    countMock.mockResolvedValueOnce(4);
    const result = await checkPlanQuestionBudget(42);
    expect(result).toEqual({ allowed: true, count: 4, limit: 5 });
  });
});

describe('blockPlanQuestionOverBudget', () => {
  beforeEach(() => {
    writeBlockedStatusDurableMock.mockClear();
    recordTransitionMock.mockClear();
    createNotificationMock.mockClear();
  });

  test('writes blocked status, records an invariant transition, and notifies once each', async () => {
    await blockPlanQuestionOverBudget(7, 3, 3);

    expect(writeBlockedStatusDurableMock).toHaveBeenCalledTimes(1);
    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
    const [transitionArgs] = recordTransitionMock.mock.calls[0] as [Record<string, unknown>];
    expect(transitionArgs).toMatchObject({
      taskId: 7,
      cause: 'plan_question_budget_exhausted',
      phase: 'plan',
      invariantViolation: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    const [notificationArgs] = createNotificationMock.mock.calls[0] as [Record<string, unknown>];
    expect(notificationArgs).toMatchObject({
      type: 'system',
      metadata: { taskId: 7, count: 3, limit: 3, reason: 'plan_question_budget_exhausted' },
    });
  });
});
