/**
 * recovery-metrics-aggregator テスト
 *
 * 窓境界（nowMs 注入で決定的に assert）/ 成功率 / null コスト除外平均 /
 * 空入力 / minSamples フラグを検証する。純関数のため mock 不要。
 */
import { describe, test, expect } from 'bun:test';
import { aggregate } from './recovery-metrics-aggregator';
import type { RecoveryAttemptRecord } from './recovery-metrics.types';

const NOW_MS = 10_000_000;
const WINDOW_MS = 1_000_000;

function makeRecord(overrides: Partial<RecoveryAttemptRecord> = {}): RecoveryAttemptRecord {
  return {
    tsMs: NOW_MS,
    taskId: 641,
    phase: 'planner',
    errorType: 'quota',
    fromProvider: 'openai',
    fromModel: 'gpt-5',
    toProvider: 'claude',
    strategy: 'reroute',
    outcome: 'success',
    latencyMs: 1000,
    costUsd: null,
    failureReason: null,
    ...overrides,
  };
}

describe('recovery-metrics-aggregator', () => {
  test('空入力は空配列を返す', () => {
    expect(aggregate([], { windowMs: WINDOW_MS, minSamples: 8, nowMs: NOW_MS })).toEqual([]);
  });

  test('窓境界: cutoff ちょうどは含まれ、1ms 手前は除外される', () => {
    const cutoff = NOW_MS - WINDOW_MS;
    const records = [makeRecord({ tsMs: cutoff }), makeRecord({ tsMs: cutoff - 1 })];

    const metrics = aggregate(records, { windowMs: WINDOW_MS, minSamples: 1, nowMs: NOW_MS });

    expect(metrics).toHaveLength(1);
    expect(metrics[0].attempts).toBe(1);
  });

  test('(errorType × strategy) でグループ化し成功率と件数内訳を算出する', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'failure', failureReason: 'rate_limit' }),
      makeRecord({ outcome: 'failure', failureReason: 'rate_limit' }),
      makeRecord({ outcome: 'failure', failureReason: 'quota' }),
      makeRecord({ errorType: 'transient', strategy: 'none', outcome: 'no_candidate' }),
    ];

    const metrics = aggregate(records, { windowMs: WINDOW_MS, minSamples: 1, nowMs: NOW_MS });

    expect(metrics).toHaveLength(2);
    const reroute = metrics.find((m) => m.strategy === 'reroute');
    expect(reroute).toMatchObject({
      errorType: 'quota',
      attempts: 4,
      successes: 1,
      failures: 3,
      noCandidates: 0,
      successRate: 0.25,
      failureReasons: { rate_limit: 2, quota: 1 },
    });
    const none = metrics.find((m) => m.strategy === 'none');
    expect(none).toMatchObject({
      errorType: 'transient',
      attempts: 1,
      noCandidates: 1,
      successRate: 0,
    });
  });

  test('avgCostUsd は null コストを除外して平均し、全件 null なら null', () => {
    const withCosts = aggregate(
      [makeRecord({ costUsd: 0.1 }), makeRecord({ costUsd: 0.3 }), makeRecord({ costUsd: null })],
      { windowMs: WINDOW_MS, minSamples: 1, nowMs: NOW_MS },
    );
    expect(withCosts[0].avgCostUsd).toBeCloseTo(0.2);

    const allNull = aggregate([makeRecord({ costUsd: null })], {
      windowMs: WINDOW_MS,
      minSamples: 1,
      nowMs: NOW_MS,
    });
    expect(allNull[0].avgCostUsd).toBeNull();
  });

  test('avgLatencyMs は全レコードの平均', () => {
    const metrics = aggregate([makeRecord({ latencyMs: 1000 }), makeRecord({ latencyMs: 3000 })], {
      windowMs: WINDOW_MS,
      minSamples: 1,
      nowMs: NOW_MS,
    });
    expect(metrics[0].avgLatencyMs).toBe(2000);
  });

  test('minSamples 未満のグループは lowSample=true のまま返される（隠さない）', () => {
    const metrics = aggregate([makeRecord(), makeRecord()], {
      windowMs: WINDOW_MS,
      minSamples: 8,
      nowMs: NOW_MS,
    });
    expect(metrics).toHaveLength(1);
    expect(metrics[0].lowSample).toBe(true);

    const enough = aggregate(
      Array.from({ length: 8 }, () => makeRecord()),
      { windowMs: WINDOW_MS, minSamples: 8, nowMs: NOW_MS },
    );
    expect(enough[0].lowSample).toBe(false);
  });

  test('attempts 降順でソートされる', () => {
    const metrics = aggregate(
      [
        makeRecord({ errorType: 'transient' }),
        makeRecord({ errorType: 'rate_limit' }),
        makeRecord({ errorType: 'rate_limit' }),
      ],
      { windowMs: WINDOW_MS, minSamples: 1, nowMs: NOW_MS },
    );
    expect(metrics.map((m) => m.errorType)).toEqual(['rate_limit', 'transient']);
  });
});
