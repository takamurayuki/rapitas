/**
 * experiment-metrics ユニットテスト
 *
 * 自己実験ループの純関数(computeTaskMetrics / judgeExperiment)を検証する:
 * 批評通過率・平均修復回数・平均所要時間の集計と、
 * improved / regressed / no_diff / insufficient の4系統の判定。
 */
import { describe, test, expect, mock } from 'bun:test';

// NOTE: experiment-metrics は retro-evidence 経由で config/database を推移的に
// import するため、worktree では実 Prisma client の解決に失敗する — 両方 mock。
const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, fatal: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noop,
  logger: noop,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { computeTaskMetrics, judgeExperiment } = await import('./experiment-metrics');
import type { ExperimentMetrics } from './experiment-types';
import type { RetroTransitionRow } from '../../workflow/process-retro/retro-types';

let nextId = 1;
const row = (over: Partial<RetroTransitionRow> = {}): RetroTransitionRow => ({
  id: nextId++,
  fromStatus: 'draft',
  toStatus: 'research_done',
  actor: 'system',
  cause: 'file_saved:research',
  phase: null,
  metadata: '{}',
  invariantViolation: false,
  createdAt: new Date(0),
  ...over,
});

const metrics = (over: Partial<ExperimentMetrics> = {}): ExperimentMetrics => ({
  criticPassRate: 0.5,
  avgRepair: 1,
  avgDurationMs: 600_000,
  sampleSize: 8,
  ...over,
});

describe('computeTaskMetrics', () => {
  test('空マップは全指標0を返す', () => {
    const m = computeTaskMetrics(new Map());
    expect(m).toEqual({ criticPassRate: 0, avgRepair: 0, avgDurationMs: 0, sampleSize: 0 });
  });

  test('批評通過率 = criticRebounds==0 のタスク割合', () => {
    const rowsByTask = new Map<number, RetroTransitionRow[]>([
      // タスク1: 批評差し戻しなし → 通過
      [1, [row(), row({ cause: 'file_saved:plan' })]],
      // タスク2: 批評差し戻し1回 → 非通過
      [2, [row({ cause: 'research_critic_failed' }), row()]],
      // タスク3: 批評差し戻しなし → 通過
      [3, [row()]],
      // タスク4: plan側の批評差し戻し → 非通過
      [4, [row({ cause: 'plan_critic_exhausted' })]],
    ]);
    const m = computeTaskMetrics(rowsByTask);
    expect(m.sampleSize).toBe(4);
    expect(m.criticPassRate).toBe(0.5);
  });

  test('avgRepair = repairCount のタスク平均', () => {
    const rowsByTask = new Map<number, RetroTransitionRow[]>([
      [1, [row({ cause: 'verify_repair' }), row({ cause: 'ci_repair' })]], // repair 2
      [2, [row({ cause: 'verify_repair' })]], // repair 1
      [3, [row()]], // repair 0
    ]);
    expect(computeTaskMetrics(rowsByTask).avgRepair).toBeCloseTo(1, 5);
  });

  test('avgDurationMs = フェーズ滞在時間合計のタスク平均(終端状態は除外)', () => {
    const rowsByTask = new Map<number, RetroTransitionRow[]>([
      [
        1,
        [
          // 0分→10分→30分: research_done に10分、plan_created に20分滞在。
          row({ toStatus: 'research_done', createdAt: new Date(0) }),
          row({ toStatus: 'plan_created', createdAt: new Date(10 * 60_000) }),
          row({ toStatus: 'completed', createdAt: new Date(30 * 60_000) }),
        ],
      ],
      [
        2,
        [
          // 0分→10分: 10分滞在。
          row({ toStatus: 'research_done', createdAt: new Date(0) }),
          row({ toStatus: 'completed', createdAt: new Date(10 * 60_000) }),
        ],
      ],
    ]);
    // (30分 + 10分) / 2タスク = 平均20分。
    expect(computeTaskMetrics(rowsByTask).avgDurationMs).toBe(20 * 60_000);
  });
});

describe('judgeExperiment', () => {
  test('通過率が+マージン以上改善かつ修復非悪化 → improved', () => {
    const control = metrics({ criticPassRate: 0.5, avgRepair: 1 });
    const treatment = metrics({ criticPassRate: 0.65, avgRepair: 1.2 });
    expect(judgeExperiment(control, treatment)).toBe('improved');
  });

  test('通過率が-マージン以下悪化 → regressed', () => {
    const control = metrics({ criticPassRate: 0.6 });
    const treatment = metrics({ criticPassRate: 0.45 });
    expect(judgeExperiment(control, treatment)).toBe('regressed');
  });

  test('通過率改善でも avgRepair が閾値超の悪化なら regressed(regression優先)', () => {
    const control = metrics({ criticPassRate: 0.5, avgRepair: 1 });
    const treatment = metrics({ criticPassRate: 0.7, avgRepair: 1.6 });
    expect(judgeExperiment(control, treatment)).toBe('regressed');
  });

  test('マージン内の差 → no_diff', () => {
    const control = metrics({ criticPassRate: 0.5, avgRepair: 1 });
    const treatment = metrics({ criticPassRate: 0.55, avgRepair: 1.1 });
    expect(judgeExperiment(control, treatment)).toBe('no_diff');
  });

  test('いずれかの窓が最小サンプル未満 → insufficient(判定より優先)', () => {
    const control = metrics({ sampleSize: 2 });
    const treatment = metrics({ criticPassRate: 0.9, sampleSize: 8 });
    expect(judgeExperiment(control, treatment)).toBe('insufficient');
    expect(judgeExperiment(metrics(), metrics({ sampleSize: 1 }))).toBe('insufficient');
  });

  test('閾値はオプションで上書きできる', () => {
    const control = metrics({ criticPassRate: 0.5 });
    const treatment = metrics({ criticPassRate: 0.55 });
    expect(judgeExperiment(control, treatment, { margin: 0.05 })).toBe('improved');
    expect(judgeExperiment(control, treatment, { minSamples: 10 })).toBe('insufficient');
  });
});
