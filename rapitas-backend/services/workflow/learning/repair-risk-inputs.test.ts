/**
 * repair-risk-inputs unit tests
 *
 * TTL cache hit/miss of the bucket table, prior-phase input-length resolution
 * with mixed-role events, and the task-description fallback. prisma and the
 * timeline are stubbed via mock.module (process-global — run in isolation).
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const transitionFindMany = mock(() => Promise.resolve([] as unknown[]));
const timelineFindMany = mock(() => Promise.resolve([] as unknown[]));
const taskFindMany = mock(() => Promise.resolve([] as unknown[]));
const taskFindUnique = mock(() => Promise.resolve(null as unknown));
mock.module('../../../config/database', () => ({
  prisma: {
    workflowTransition: { findMany: transitionFindMany },
    timelineEvent: { findMany: timelineFindMany },
    task: { findMany: taskFindMany, findUnique: taskFindUnique },
    agentExecution: { findMany: mock(() => Promise.resolve([])) },
  },
  ensureDatabaseConnection: mock(() => Promise.resolve()),
}));

const queryEventsMock = mock((_opts: unknown) =>
  Promise.resolve({ events: [] as unknown[], total: 0, limit: 200, offset: 0 }),
);
mock.module('../../memory/timeline', () => ({
  queryEvents: queryEventsMock,
  appendEvent: mock(() => Promise.resolve({ id: 1 })),
}));

const {
  getBucketTable,
  resetRepairRiskCache,
  resolveInputLength,
  toMetricRow,
  fetchTaskComplexity,
} = await import('./repair-risk-inputs');

const realNow = Date.now;

describe('getBucketTable', () => {
  beforeEach(() => {
    resetRepairRiskCache();
    transitionFindMany
      .mockReset()
      .mockResolvedValue([
        { taskId: 1, cause: 'verify_repair', phase: 'implementer', createdAt: new Date() },
      ]);
    timelineFindMany.mockReset().mockResolvedValue([
      {
        payload: JSON.stringify({ taskId: 1, role: 'planner', totalChars: 12000 }),
        createdAt: new Date(),
      },
      {
        payload: JSON.stringify({ taskId: 1, role: 'implementer', totalChars: 30000 }),
        createdAt: new Date(),
      },
      { payload: 'not json', createdAt: new Date() },
    ]);
    taskFindMany
      .mockReset()
      .mockResolvedValue([{ id: 1, complexityScore: 80, description: 'x'.repeat(50) }]);
  });
  afterEach(() => {
    Date.now = realNow;
  });

  test('キャッシュヒット時は DB を再集計しない', async () => {
    const first = await getBucketTable();
    const second = await getBucketTable();
    expect(second).toBe(first);
    expect(transitionFindMany).toHaveBeenCalledTimes(1);
    expect(timelineFindMany).toHaveBeenCalledTimes(1);
    expect(first.get('high|long|implement')).toEqual({ sampleSize: 1, repairRate: 1 });
  });

  test('TTL(10分)切れで再集計する', async () => {
    const base = realNow();
    Date.now = () => base;
    await getBucketTable();
    Date.now = () => base + 10 * 60 * 1000 + 1;
    await getBucketTable();
    expect(transitionFindMany).toHaveBeenCalledTimes(2);
  });
});

describe('resolveInputLength', () => {
  beforeEach(() => {
    queryEventsMock.mockReset();
  });

  test('research は説明文の長さで、タイムラインを読まない', async () => {
    const r = await resolveInputLength(5, { description: 'abcd' }, 'research');
    expect(r).toEqual({ chars: 4, source: 'task_description' });
    expect(queryEventsMock).not.toHaveBeenCalled();
  });

  test('ロール混在のイベントから直前ロール(planner)の最新値だけを採用する', async () => {
    queryEventsMock.mockResolvedValue({
      events: [
        {
          payload: { taskId: 5, role: 'implementer', totalChars: 99999 },
          createdAt: new Date(3000),
        },
        { payload: { taskId: 5, role: 'planner', totalChars: 7000 }, createdAt: new Date(2000) },
        { payload: { taskId: 5, role: 'planner', totalChars: 1000 }, createdAt: new Date(1000) },
        { payload: { taskId: 5, role: 'researcher', totalChars: 50000 }, createdAt: new Date(500) },
      ],
      total: 4,
      limit: 200,
      offset: 0,
    });
    const r = await resolveInputLength(5, { description: 'abcd' }, 'implement');
    expect(r).toEqual({ chars: 7000, source: 'prior_phase_metrics' });
    expect(queryEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'context_section_metrics', correlationId: 'task_5' }),
    );
  });

  test('直前フェーズの計測が無ければ説明文の長さにフォールバック', async () => {
    queryEventsMock.mockResolvedValue({ events: [], total: 0, limit: 200, offset: 0 });
    const r = await resolveInputLength(5, { description: null }, 'verify');
    expect(r).toEqual({ chars: 0, source: 'task_description_fallback' });
  });
});

describe('toMetricRow / fetchTaskComplexity', () => {
  test('形の合わない payload は null', () => {
    expect(toMetricRow({ taskId: '1', role: 'x', totalChars: 1 }, new Date())).toBeNull();
    expect(toMetricRow('{', new Date())).toBeNull();
    expect(toMetricRow(null, new Date())).toBeNull();
  });
  test('complexityScore 未確定は null', async () => {
    taskFindUnique.mockResolvedValueOnce({ complexityScore: null });
    expect(await fetchTaskComplexity(1)).toBeNull();
    taskFindUnique.mockResolvedValueOnce({ complexityScore: 72 });
    expect(await fetchTaskComplexity(1)).toBe(72);
  });
});
