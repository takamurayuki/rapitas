/**
 * workflow-plan-question-guard テスト
 *
 * checkPlanQuestionBudget/blockPlanQuestionOverBudget のカウント・fail-closed・
 * fromStatus フィルタ・環境変数上書き・上限到達時の副作用を検証する。
 *
 * 2026-10-14 追加: 人の作業待ち（operatorWait）の周回をエージェントの質問予算と
 * 別の軸で数えることを検証する。#1215 では 3 周が同じ予算を共有し、4 周目の
 * 「運用者作業が終わるまで保留にする」という正当なエスカレーションが
 * {"count":3,"limit":3} で弾かれて blocked になった。
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const findManyMock = mock(() => Promise.resolve([] as { metadata: unknown }[]));
const mockPrisma = {
  workflowTransition: {
    findMany: findManyMock,
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

/** n rounds recorded before the operatorWait key existed (metadata has no flag). */
const agentRounds = (n: number) =>
  Array.from({ length: n }, () => ({ metadata: { sizeBytes: 1894 } }));

/** n rounds recorded as waiting on human work. */
const operatorRounds = (n: number) =>
  Array.from({ length: n }, () => ({ metadata: { operatorWait: true } }));

describe('checkPlanQuestionBudget', () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  afterEach(() => {
    delete process.env.RAPITAS_MAX_PLAN_QUESTION_ROUNDS;
    delete process.env.RAPITAS_MAX_OPERATOR_WAIT_ROUNDS;
  });

  test.each([0, 1, 2])('count=%i (below default limit 3) is allowed', async (count) => {
    findManyMock.mockResolvedValueOnce(agentRounds(count));
    const result = await checkPlanQuestionBudget(42);
    expect(result).toMatchObject({ allowed: true, count, limit: 3 });
  });

  test.each([3, 4])('count=%i (at/above default limit 3) is not allowed', async (count) => {
    findManyMock.mockResolvedValueOnce(agentRounds(count));
    const result = await checkPlanQuestionBudget(42);
    expect(result).toMatchObject({ allowed: false, count, limit: 3, exhausted: 'agent' });
  });

  test('a DB error is treated as exhausted on both axes (fail-closed)', async () => {
    findManyMock.mockRejectedValueOnce(new Error('db down'));
    const result = await checkPlanQuestionBudget(42);
    expect(result).toMatchObject({ allowed: false, count: 3, limit: 3 });
    findManyMock.mockRejectedValueOnce(new Error('db down'));
    const operator = await checkPlanQuestionBudget(42, true);
    expect(operator.allowed).toBe(false);
  });

  test('queries by cause + fromStatus, not by phase', async () => {
    findManyMock.mockResolvedValueOnce([]);
    await checkPlanQuestionBudget(42);
    expect(findManyMock).toHaveBeenCalledWith({
      where: { taskId: 42, cause: 'file_saved:question', fromStatus: 'plan_approved' },
      select: { metadata: true },
    });
  });

  test('RAPITAS_MAX_PLAN_QUESTION_ROUNDS overrides the default limit', async () => {
    process.env.RAPITAS_MAX_PLAN_QUESTION_ROUNDS = '5';
    findManyMock.mockResolvedValueOnce(agentRounds(4));
    const result = await checkPlanQuestionBudget(42);
    expect(result).toMatchObject({ allowed: true, count: 4, limit: 5 });
  });

  // #1215 の実測形。人の作業待ちが 3 周あっても、エージェントの質問予算は
  // 1 周も使っていない。
  test('人の作業待ちの周回はエージェントの質問予算を消費しない', async () => {
    findManyMock.mockResolvedValueOnce(operatorRounds(3));
    const result = await checkPlanQuestionBudget(42);
    expect(result).toMatchObject({ allowed: true, count: 0, operatorCount: 3 });
  });

  test('新しい周が人の作業待ちなら、人の軸で判定する', async () => {
    findManyMock.mockResolvedValueOnce([...agentRounds(3), ...operatorRounds(1)]);
    const result = await checkPlanQuestionBudget(42, true);
    // エージェント側は使い切っているが、人の作業待ちの軸はまだ 1/3。
    expect(result).toMatchObject({ allowed: true, count: 3, operatorCount: 1 });
  });

  test('人の作業待ちの軸も上限で止まり、どちらの軸が尽きたかを返す', async () => {
    findManyMock.mockResolvedValueOnce(operatorRounds(3));
    const result = await checkPlanQuestionBudget(42, true);
    expect(result).toMatchObject({
      allowed: false,
      operatorCount: 3,
      operatorLimit: 3,
      exhausted: 'operator',
    });
  });

  test('RAPITAS_MAX_OPERATOR_WAIT_ROUNDS overrides the operator-axis limit', async () => {
    process.env.RAPITAS_MAX_OPERATOR_WAIT_ROUNDS = '1';
    findManyMock.mockResolvedValueOnce(operatorRounds(1));
    const result = await checkPlanQuestionBudget(42, true);
    expect(result).toMatchObject({ allowed: false, operatorLimit: 1, exhausted: 'operator' });
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

  // 同じ「上限到達」でも、原因が人の作業未実施なら人に伝える内容が変わる。
  // 「質問しすぎ」と報告すると、運用者は自分が止めている側だと気づけない。
  test('人の作業待ちで止めたときは別の cause と理由を記録する', async () => {
    await blockPlanQuestionOverBudget(7, 3, 3, 'operator');

    const [transitionArgs] = recordTransitionMock.mock.calls[0] as [Record<string, unknown>];
    expect(transitionArgs).toMatchObject({
      taskId: 7,
      cause: 'operator_action_wait_exhausted',
      invariantViolation: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const [notificationArgs] = createNotificationMock.mock.calls[0] as [Record<string, unknown>];
    expect(notificationArgs).toMatchObject({
      metadata: { reason: 'operator_action_wait_exhausted' },
    });
  });
});
