/**
 * Self-Observation Query テスト
 *
 * Aggregates per-execution metrics into the dashboard payload format.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockExecutionFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../../config/database', () => ({
  prisma: {
    agentExecution: { findMany: mockExecutionFindMany },
  },
}));

import { getSelfObservationSummary } from '../../../routes/agents/agent-metrics/observation-query';

describe('getSelfObservationSummary', () => {
  beforeEach(() => {
    mockExecutionFindMany.mockReset();
  });

  it('空のDBで0埋めの日次バケットを返す', async () => {
    mockExecutionFindMany.mockResolvedValue([]);
    const r = await getSelfObservationSummary(7);

    expect(r.windowDays).toBe(7);
    expect(r.totalCostUsd).toBe(0);
    expect(r.totalExecutions).toBe(0);
    expect(r.cacheHitRate).toBe(0);
    expect(r.errorRate).toBe(0);
    expect(r.dailyCost.length).toBe(7);
    expect(r.modelMix.length).toBe(0);
  });

  it('複数行から合計・キャッシュ命中率・モデル分布を計算する', async () => {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);

    mockExecutionFindMany.mockResolvedValue([
      {
        startedAt: today,
        createdAt: today,
        status: 'completed',
        errorMessage: null,
        executionTimeMs: 1000,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 900,
        cacheCreationInputTokens: 0,
        costUsd: '0.012345',
        modelName: 'claude-haiku-4-5-20251001',
      },
      {
        startedAt: today,
        createdAt: today,
        status: 'failed',
        errorMessage: 'oops',
        executionTimeMs: 2000,
        inputTokens: 200,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: '0.001000',
        modelName: 'claude-sonnet-4-6-20250610',
      },
    ]);

    const r = await getSelfObservationSummary(14);

    expect(r.totalExecutions).toBe(2);
    expect(r.totalInputTokens).toBe(300);
    expect(r.totalCacheReadInputTokens).toBe(900);
    expect(r.totalCostUsd).toBeCloseTo(0.013345, 6);
    // cache_read / (cache_read + input) = 900 / (900 + 300) = 0.75
    expect(r.cacheHitRate).toBeCloseTo(0.75, 4);
    // 1 of 2 failed
    expect(r.errorRate).toBeCloseTo(0.5, 4);
    expect(r.averageExecutionTimeMs).toBe(1500);
    expect(r.modelMix.length).toBe(2);
    // Highest cost first
    expect(r.modelMix[0].modelName).toBe('claude-haiku-4-5-20251001');
    expect(r.modelMix[0].shareOfCost).toBeGreaterThan(0.5);
  });
});
