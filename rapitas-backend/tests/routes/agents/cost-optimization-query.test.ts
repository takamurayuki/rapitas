/**
 * Cost Optimization Query テスト
 *
 * Guards against the dual-cost bug: /agent-metrics/cost-optimization used to
 * re-derive cost from a hardcoded per-1k-token rate table even when a
 * recorded `AgentExecution.costUsd` existed, so the same execution reported
 * two different costs depending on which endpoint you asked. These tests
 * assert the recorded cost wins, the rate table is only a fallback, and the
 * number agrees with the self-observation summary for the same execution.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockExecutionFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    agentExecution: { findMany: mockExecutionFindMany },
  },
}));

import { getCostOptimizationInsights } from '../../../routes/agents/agent-metrics/cost-optimization-query';
import { getSelfObservationSummary } from '../../../routes/agents/agent-metrics/observation-query';

describe('getCostOptimizationInsights', () => {
  beforeEach(() => {
    mockExecutionFindMany.mockReset();
  });

  it('uses the recorded costUsd instead of re-deriving from the rate table', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        status: 'completed',
        // 100k tokens would cost $1.00 at the default 0.01/1k fallback rate —
        // but a recorded cost exists, so that must win instead.
        tokensUsed: 100000,
        executionTimeMs: 1000,
        costUsd: '0.05',
        agentConfig: {
          modelId: 'claude-sonnet-4-20250514',
          agentType: 'implementer',
          name: 'x',
        },
      },
    ]);

    const insights = await getCostOptimizationInsights();

    expect(insights.totalCost).toBeCloseTo(0.05, 6);
    expect(insights.modelBreakdown[0].estimatedCost).toBeCloseTo(0.05, 6);
  });

  it('falls back to the per-1k rate table when no cost was recorded', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        status: 'completed',
        tokensUsed: 100000,
        executionTimeMs: 500,
        costUsd: '0',
        agentConfig: {
          modelId: 'claude-haiku-4-5-20251001',
          agentType: 'implementer',
          name: 'x',
        },
      },
    ]);

    const insights = await getCostOptimizationInsights();

    // 100k tokens / 1000 * $0.002 (haiku fallback rate) = $0.20
    expect(insights.totalCost).toBeCloseTo(0.2, 6);
  });

  it('agrees with the self-observation summary for the same recorded-cost execution', async () => {
    const now = new Date();
    const row = {
      startedAt: now,
      createdAt: now,
      status: 'completed',
      errorMessage: null,
      executionTimeMs: 1200,
      inputTokens: 500,
      outputTokens: 200,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      tokensUsed: 700,
      costUsd: '0.05',
      modelName: 'claude-sonnet-4-20250514',
      llmCallCount: 3,
      agentConfig: { modelId: 'claude-sonnet-4-20250514', agentType: 'implementer', name: 'x' },
    };

    mockExecutionFindMany.mockResolvedValue([row]);

    const [costOptimization, selfObservation] = await Promise.all([
      getCostOptimizationInsights(),
      getSelfObservationSummary(14),
    ]);

    expect(costOptimization.totalCost).toBeCloseTo(selfObservation.totalCostUsd, 6);
  });
});
