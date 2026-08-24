/**
 * recall-metrics テスト
 *
 * 集計の比率計算、`api` ソースの実行比からの除外、0 件時のゼロ集計、
 * DB 例外時のゼロ集計を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockFindMany = mock((_args: Record<string, unknown>) =>
  Promise.resolve([] as Array<{ payload: string }>),
);
const mockCount = mock((_args: Record<string, unknown>) => Promise.resolve(0));

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
}));
mock.module('../../../config/database', () => ({
  prisma: { timelineEvent: { findMany: mockFindMany, count: mockCount } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { aggregateRecallMetrics, getRecallMetrics } = await import('./recall-metrics');

function sample(over: Partial<Parameters<typeof aggregateRecallMetrics>[0][number]>) {
  return {
    source: 'workflow',
    returned: 0,
    vectorCandidates: 0,
    lexicalCandidates: 0,
    topSimilarity: null,
    topLexical: null,
    ...over,
  };
}

beforeEach(() => {
  mockFindMany.mockReset().mockReturnValue(Promise.resolve([]));
  mockCount.mockReset().mockReturnValue(Promise.resolve(0));
});

describe('aggregateRecallMetrics', () => {
  test('0 件ならすべてゼロ（null 平均）', () => {
    const m = aggregateRecallMetrics([], 0, 7);
    expect(m).toMatchObject({
      days: 7,
      attempts: 0,
      nonEmpty: 0,
      nonEmptyRate: 0,
      avgReturned: 0,
      avgTopSimilarity: null,
      avgTopLexical: null,
      lexicalOnlyShare: 0,
      executions: 0,
      attemptsPerExecution: 0,
      nonEmptyPerExecution: 0,
      bySource: {},
    });
  });

  test('比率・平均・ソース別を計算し、api は実行比の分子から除外する', () => {
    const m = aggregateRecallMetrics(
      [
        sample({ source: 'workflow', returned: 3, vectorCandidates: 2, topSimilarity: 0.6 }),
        sample({ source: 'workflow', returned: 0 }),
        sample({
          source: 'task_rag',
          returned: 1,
          lexicalCandidates: 1,
          topLexical: 0.3,
        }),
        sample({ source: 'api', returned: 2, vectorCandidates: 2, topSimilarity: 0.8 }),
      ],
      10,
      1,
    );
    expect(m.attempts).toBe(4);
    expect(m.nonEmpty).toBe(3);
    expect(m.nonEmptyRate).toBeCloseTo(0.75, 10);
    expect(m.avgReturned).toBeCloseTo(1.5, 10);
    expect(m.avgTopSimilarity).toBeCloseTo(0.7, 10);
    expect(m.avgTopLexical).toBeCloseTo(0.3, 10);
    // 1 of the 3 non-empty attempts had no vector candidates.
    expect(m.lexicalOnlyShare).toBeCloseTo(1 / 3, 10);
    expect(m.executions).toBe(10);
    // workflow ×2 + task_rag ×1 = 3 agent-path attempts; api excluded.
    expect(m.attemptsPerExecution).toBeCloseTo(0.3, 10);
    expect(m.nonEmptyPerExecution).toBeCloseTo(0.2, 10);
    expect(m.bySource).toEqual({
      workflow: { attempts: 2, nonEmpty: 1 },
      task_rag: { attempts: 1, nonEmpty: 1 },
      api: { attempts: 1, nonEmpty: 1 },
    });
  });
});

describe('getRecallMetrics', () => {
  test('timeline の memory_recall_attempt と実行数を読み集計する', async () => {
    mockFindMany.mockReturnValue(
      Promise.resolve([
        { payload: JSON.stringify({ source: 'workflow', returned: 2, vectorCandidates: 2 }) },
        { payload: '{broken json' },
      ]),
    );
    mockCount.mockReturnValue(Promise.resolve(4));
    const m = await getRecallMetrics(3);
    expect(m.days).toBe(3);
    expect(m.attempts).toBe(1); // unparsable payload dropped
    expect(m.executions).toBe(4);
    expect(m.attemptsPerExecution).toBeCloseTo(0.25, 10);
    const where = mockFindMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.eventType).toBe('memory_recall_attempt');
    const countWhere = mockCount.mock.calls[0][0].where as Record<string, unknown>;
    expect(countWhere.eventType).toEqual({
      in: ['agent_execution_completed', 'agent_execution_failed'],
    });
  });

  test('DB 例外時はゼロ集計を返す', async () => {
    mockFindMany.mockReturnValue(Promise.reject(new Error('db down')));
    const m = await getRecallMetrics(7);
    expect(m.attempts).toBe(0);
    expect(m.executions).toBe(0);
  });
});
