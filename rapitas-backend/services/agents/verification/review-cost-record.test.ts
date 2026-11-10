/**
 * review-cost-record.test
 *
 * The jury's spend lands as AgentExecution rows the budgets already sum, and
 * those rows are marked so no "latest execution" read mistakes them for the
 * implementer's run.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';

const sessionFindFirst = mock(async (_a: unknown): Promise<{ id: number } | null> => ({ id: 42 }));
const executionCreate = mock(async (_a: unknown) => ({}));
const executionFindMany = mock(async (_a: unknown) => [
  { costUsd: 0.5, tokensUsed: 100, claudeSessionId: 'impl', startedAt: new Date(0) },
  { costUsd: 0.02, tokensUsed: 30, claudeSessionId: null, startedAt: new Date(1) },
]);
const sessionUpdate = mock(async (_a: unknown) => ({ count: 1 }));
mock.module('../../../config/database', () => ({
  prisma: {
    agentSession: {
      findFirst: sessionFindFirst,
      // Totals are written compare-and-swap on lastActivityAt (session-cost-totals.ts).
      findUnique: mock(async () => ({ lastActivityAt: new Date(0) })),
      updateMany: sessionUpdate,
    },
    agentExecution: { create: executionCreate, findMany: executionFindMany },
    agentAction: { findMany: mock(async () => []) },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { recordReviewCost } = await import('./review-cost-record');
const { REVIEW_COST_COMMAND, NOT_REVIEW_COST_ROW } = await import('../review-cost-rows');

const usage = (costUsd: number) => ({
  costUsd,
  tokensUsed: 30,
  inputTokens: 10,
  outputTokens: 20,
  startedAt: new Date('2026-11-10T00:00:00Z'),
  durationMs: 1500,
});

beforeEach(() => {
  sessionFindFirst.mockReset().mockResolvedValue({ id: 42 });
  executionCreate.mockClear();
  sessionUpdate.mockClear();
});

describe('recordReviewCost', () => {
  test('one row per answering juror under the newest session, marked as a review row', async () => {
    const n = await recordReviewCost({
      taskId: 7,
      verdict: 'pass',
      jurors: [
        {
          provider: 'claude',
          model: 'claude-opus-4-20250514',
          verdict: 'pass',
          severity: 0,
          reasons: [],
          usage: usage(0.02),
        },
        {
          provider: 'claude',
          model: 'claude-sonnet-4-20250514',
          verdict: 'unknown',
          severity: 0,
          reasons: [],
          unknownReason: 'timeout',
        },
      ],
    });
    expect(n).toBe(1);
    expect(sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { config: { taskId: 7 } }, orderBy: { createdAt: 'desc' } }),
    );
    expect(executionCreate).toHaveBeenCalledTimes(1);
    const data = (executionCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      sessionId: 42,
      command: REVIEW_COST_COMMAND,
      status: 'completed',
      costUsd: 0.02,
      tokensUsed: 30,
      inputTokens: 10,
      outputTokens: 20,
      modelName: 'claude-opus-4-20250514',
      llmCallCount: 1,
      executionTimeMs: 1500,
    });
    // claudeSessionId stays null: a one-shot --print is not resumable and
    // must not be chained with the implementer's cumulative CLI session.
    expect(data.claudeSessionId).toBeUndefined();
  });

  test('re-totals the session from its rows so the review cost is included once', async () => {
    await recordReviewCost({
      taskId: 7,
      verdict: 'fail',
      jurors: [
        {
          provider: 'claude',
          model: 'm',
          verdict: 'fail',
          severity: 80,
          reasons: [],
          usage: usage(0.02),
        },
      ],
    });
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: 42, lastActivityAt: new Date(0) },
      data: expect.objectContaining({ totalCostUsd: 0.52, totalTokensUsed: 130 }),
    });
  });

  test('writes nothing when the task has no session or no juror answered', async () => {
    sessionFindFirst.mockResolvedValueOnce(null);
    expect(
      await recordReviewCost({
        taskId: 7,
        verdict: 'pass',
        jurors: [
          { provider: 'claude', verdict: 'pass', severity: 0, reasons: [], usage: usage(0.01) },
        ],
      }),
    ).toBe(0);
    expect(
      await recordReviewCost({
        taskId: 7,
        verdict: 'unknown',
        jurors: [{ provider: 'claude', verdict: 'unknown', severity: 0, reasons: [] }],
      }),
    ).toBe(0);
    expect(executionCreate).not.toHaveBeenCalled();
  });

  test('never throws on a DB error', async () => {
    sessionFindFirst.mockRejectedValueOnce(new Error('db down'));
    expect(
      await recordReviewCost({
        taskId: 7,
        verdict: 'pass',
        jurors: [
          { provider: 'claude', verdict: 'pass', severity: 0, reasons: [], usage: usage(0.01) },
        ],
      }),
    ).toBe(0);
  });
});

describe('NOT_REVIEW_COST_ROW', () => {
  test('is the command filter every latest-execution read spreads in', () => {
    expect(NOT_REVIEW_COST_ROW).toEqual({ command: { not: 'adversarial-review' } });
  });
});
