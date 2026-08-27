/**
 * probe-metrics-aggregator テスト
 *
 * 窓境界（nowMs 注入で決定的に assert）/ 成功率 / 空入力 / minSamples フラグ /
 * ソート順を検証する。純関数のため mock 不要。
 */
import { describe, test, expect } from 'bun:test';
import { aggregate } from './probe-metrics-aggregator';
import type { ProbeAttemptRecord } from './probe-metrics.types';

const NOW_MS = 10_000_000;
const WINDOW_MS = 1_000_000;

function makeRecord(overrides: Partial<ProbeAttemptRecord> = {}): ProbeAttemptRecord {
  return {
    tsMs: NOW_MS,
    taskId: 673,
    role: 'researcher',
    targetId: 'db',
    outcome: 'success',
    attempts: 1,
    latencyMs: 1000,
    errorMessage: null,
    ...overrides,
  };
}

describe('probe-metrics-aggregator', () => {
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

  test('targetId でグループ化し成功率と内訳を算出する', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'permanent_failure' }),
      makeRecord({ outcome: 'permanent_failure' }),
      makeRecord({ outcome: 'transient_retry' }),
      makeRecord({ targetId: 'agent-endpoint', outcome: 'success' }),
    ];

    const metrics = aggregate(records, { windowMs: WINDOW_MS, minSamples: 1, nowMs: NOW_MS });

    expect(metrics).toHaveLength(2);
    const db = metrics.find((m) => m.targetId === 'db');
    expect(db).toMatchObject({
      attempts: 4,
      successes: 1,
      transientRetries: 1,
      permanentFailures: 2,
      successRate: 0.25,
    });
    const agentEndpoint = metrics.find((m) => m.targetId === 'agent-endpoint');
    expect(agentEndpoint).toMatchObject({ attempts: 1, successes: 1, successRate: 1 });
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
        makeRecord({ targetId: 'agent-endpoint' }),
        makeRecord({ targetId: 'db' }),
        makeRecord({ targetId: 'db' }),
      ],
      { windowMs: WINDOW_MS, minSamples: 1, nowMs: NOW_MS },
    );
    expect(metrics.map((m) => m.targetId)).toEqual(['db', 'agent-endpoint']);
  });
});
