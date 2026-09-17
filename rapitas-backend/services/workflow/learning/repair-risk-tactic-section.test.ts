/**
 * repair-risk-tactic-section unit tests
 *
 * high / low / indeterminate branches (block + snapshot), null complexity,
 * tactic selection by severity, and fail-open on errors. The inputs layer and
 * prisma are stubbed via mock.module (process-global — run in isolation).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const activityCreate = mock((_args: unknown) => Promise.resolve({ id: 1 }));
mock.module('../../../config/database', () => ({
  prisma: { activityLog: { create: activityCreate } },
  ensureDatabaseConnection: mock(() => Promise.resolve()),
}));

const fetchTaskComplexity = mock((_id: number) => Promise.resolve(80 as number | null));
const resolveInputLength = mock(() =>
  Promise.resolve({ chars: 10000, source: 'prior_phase_metrics' as const }),
);
const getBucketTable = mock(() => Promise.resolve(new Map()));
mock.module('./repair-risk-inputs', () => ({
  fetchTaskComplexity,
  resolveInputLength,
  getBucketTable,
  resetRepairRiskCache: () => {},
  fetchRecentTransitionsForBuckets: mock(() => Promise.resolve([])),
  toMetricRow: () => null,
}));

const { buildRepairRiskTacticSection, renderRepairRiskTacticSection, selectTactics } =
  await import('./repair-risk-tactic-section');

const KEY = 'high|long|implement';
const TASK = { description: 'd' };

describe('buildRepairRiskTacticSection', () => {
  beforeEach(() => {
    activityCreate.mockReset().mockResolvedValue({ id: 1 });
    fetchTaskComplexity.mockReset().mockResolvedValue(80);
    getBucketTable.mockReset();
  });

  test('high: 戦術ブロックを返し、予測スナップショットを記録する', async () => {
    getBucketTable.mockResolvedValue(new Map([[KEY, { sampleSize: 10, repairRate: 0.5 }]]));
    const out = await buildRepairRiskTacticSection(7, TASK, 'implement', 'ja');
    expect(out).toContain('差し戻し高リスク判定');
    expect(out).toContain(KEY);
    expect(out).toContain('詳細度UP');
    expect(out).toContain('制約明示');
    expect(activityCreate).toHaveBeenCalledTimes(1);
    const arg = activityCreate.mock.calls[0]![0] as {
      data: { taskId: number; action: string; metadata: string };
    };
    expect(arg.data.action).toBe('repair_risk_predicted');
    expect(arg.data.taskId).toBe(7);
    expect(JSON.parse(arg.data.metadata)).toMatchObject({
      risk: 'high',
      stream: 'implement',
      inputChars: 10000,
      complexityScore: 80,
    });
  });

  test('low: 空文字列でスナップショットなし', async () => {
    getBucketTable.mockResolvedValue(new Map([[KEY, { sampleSize: 10, repairRate: 0.1 }]]));
    expect(await buildRepairRiskTacticSection(7, TASK, 'implement', 'ja')).toBe('');
    expect(activityCreate).not.toHaveBeenCalled();
  });

  test('indeterminate (サンプル不足): 空文字列でスナップショットなし', async () => {
    getBucketTable.mockResolvedValue(new Map([[KEY, { sampleSize: 3, repairRate: 1 }]]));
    expect(await buildRepairRiskTacticSection(7, TASK, 'implement', 'ja')).toBe('');
    expect(activityCreate).not.toHaveBeenCalled();
  });

  test('complexityScore 未確定なら判定しない', async () => {
    fetchTaskComplexity.mockResolvedValue(null);
    expect(await buildRepairRiskTacticSection(7, TASK, 'implement', 'ja')).toBe('');
    expect(getBucketTable).not.toHaveBeenCalled();
  });

  test('集計が例外を投げてもフェイルオープンで空文字列', async () => {
    getBucketTable.mockRejectedValue(new Error('db down'));
    expect(await buildRepairRiskTacticSection(7, TASK, 'implement', 'en')).toBe('');
  });

  test('スナップショット記録の失敗でもブロックは返る', async () => {
    getBucketTable.mockResolvedValue(new Map([[KEY, { sampleSize: 10, repairRate: 0.5 }]]));
    activityCreate.mockRejectedValue(new Error('write failed'));
    expect(await buildRepairRiskTacticSection(7, TASK, 'implement', 'en')).toContain(
      'High repair-risk run',
    );
  });
});

describe('selectTactics / renderRepairRiskTacticSection', () => {
  test('重度(>=0.6)のみ具体例を追加', () => {
    expect(selectTactics(0.4)).toEqual(['detail', 'constraints']);
    expect(selectTactics(0.6)).toEqual(['detail', 'examples', 'constraints']);
  });
  test('high 以外は描画しない', () => {
    const base = { bucketKey: KEY, sampleSize: 10, repairRate: 0.9 };
    expect(renderRepairRiskTacticSection({ ...base, risk: 'low' }, 'plan', 'ja')).toBe('');
    const out = renderRepairRiskTacticSection({ ...base, risk: 'high' }, 'plan', 'ja');
    expect(out).toContain('具体例追加');
    expect(out).toContain('90%');
  });
});
