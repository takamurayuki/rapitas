/**
 * Cost Optimization Query テスト
 *
 * Guards three bugs on /agent-metrics/cost-optimization:
 * 1. Dual-cost: it used to re-derive cost from a hardcoded per-1k-token rate
 *    table even when a recorded `AgentExecution.costUsd` existed, so the same
 *    execution reported two different costs.
 * 2. Broken breakdown: it grouped by `agentConfig.modelId` (the static config
 *    model, identical across rows under Smart Router) and filtered to
 *    `status: 'completed'`, so every execution collapsed into one 100%-success
 *    bucket and the suggestion engine never fired. These tests pin the fix:
 *    group by the actually-invoked `modelName`, count failures in the
 *    denominator, and keep null-model rows as an 'unknown' bucket.
 * 3. Cross-segment suggestions: `suggestions` now only compares models sharing
 *    the same workflow role and complexity band, and only once each side has
 *    at least 5 executions (see `buildSegmentSuggestions`). The suggestion
 *    test below supplies `session.mode`/`complexityScore` and 5 executions
 *    per model to match that contract instead of the old whole-fleet
 *    comparison.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockExecutionFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    agentExecution: { findMany: mockExecutionFindMany },
  },
}));

import { getCostOptimizationInsights } from '../../../routes/agents/agent-metrics/queries/cost-optimization-query';
import { getSelfObservationSummary } from '../../../routes/agents/agent-metrics/queries/observation-query';

// Mirrors the un-exported MIN_COMPARABLE_EXECUTIONS in cost-optimization-query.ts —
// buildSegmentSuggestions ignores a model within a segment until it reaches this count.
const MIN_COMPARABLE_EXECUTIONS = 5;

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
        modelName: 'claude-sonnet-4-20250514',
        tokensUsed: 100000,
        executionTimeMs: 1000,
        costUsd: '0.05',
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
        modelName: 'claude-haiku-4-5-20251001',
        tokensUsed: 100000,
        executionTimeMs: 500,
        costUsd: '0',
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
    };

    mockExecutionFindMany.mockResolvedValue([row]);

    const [costOptimization, selfObservation] = await Promise.all([
      getCostOptimizationInsights(),
      getSelfObservationSummary(14),
    ]);

    expect(costOptimization.totalCost).toBeCloseTo(selfObservation.totalCostUsd, 6);
  });

  it('groups by the actually-invoked modelName, not a single collapsed bucket', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        status: 'completed',
        modelName: 'fable-5',
        tokensUsed: 1000,
        executionTimeMs: 100,
        costUsd: '0.01',
      },
      {
        status: 'completed',
        modelName: 'haiku',
        tokensUsed: 1000,
        executionTimeMs: 100,
        costUsd: '0.01',
      },
      {
        status: 'completed',
        modelName: 'sonnet-5',
        tokensUsed: 1000,
        executionTimeMs: 100,
        costUsd: '0.01',
      },
    ]);

    const insights = await getCostOptimizationInsights();

    const models = insights.modelBreakdown.map((m) => m.model).sort();
    expect(models).toEqual(['fable-5', 'haiku', 'sonnet-5']);
    expect(insights.totalExecutions).toBe(3);
  });

  it('keeps null-model rows as an "unknown" bucket instead of dropping them', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        status: 'completed',
        modelName: null,
        tokensUsed: 500,
        executionTimeMs: 100,
        costUsd: '0.01',
      },
      { status: 'failed', modelName: null, tokensUsed: 0, executionTimeMs: 0, costUsd: '0' },
    ]);

    const insights = await getCostOptimizationInsights();

    const unknown = insights.modelBreakdown.find((m) => m.model === 'unknown');
    expect(unknown).toBeDefined();
    expect(unknown?.executions).toBe(2);
  });

  it('defines successRate as completed / all executions (failures in the denominator)', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        status: 'completed',
        modelName: 'opus-4-8',
        tokensUsed: 1000,
        executionTimeMs: 100,
        costUsd: '0.02',
      },
      {
        status: 'completed',
        modelName: 'opus-4-8',
        tokensUsed: 1000,
        executionTimeMs: 100,
        costUsd: '0.02',
      },
      {
        status: 'completed',
        modelName: 'opus-4-8',
        tokensUsed: 1000,
        executionTimeMs: 100,
        costUsd: '0.02',
      },
      { status: 'failed', modelName: 'opus-4-8', tokensUsed: 0, executionTimeMs: 0, costUsd: '0' },
    ]);

    const insights = await getCostOptimizationInsights();

    const opus = insights.modelBreakdown.find((m) => m.model === 'opus-4-8');
    // 3 completed / 4 total = 75%
    expect(opus?.successRate).toBe(75);
    expect(opus?.successCount).toBe(3);
    expect(opus?.executions).toBe(4);
  });

  it('fires a suggestion when a cheaper model matches the expensive one within the same role/complexity segment', async () => {
    const session = {
      mode: 'workflow-implementer',
      config: { task: { complexityScore: 20 } },
    };
    const buildRows = (modelName: string, costUsd: string) =>
      Array.from({ length: MIN_COMPARABLE_EXECUTIONS }, () => ({
        status: 'completed',
        modelName,
        tokensUsed: 1000,
        executionTimeMs: 100,
        costUsd,
        session,
      }));

    mockExecutionFindMany.mockResolvedValue([
      // Expensive model: high recorded cost, 100% success.
      ...buildRows('opus-4-8', '1.00'),
      // Cheaper model: low cost, also 100% success — a valid substitute.
      ...buildRows('haiku', '0.05'),
    ]);

    const insights = await getCostOptimizationInsights();

    expect(insights.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(insights.suggestions[0]).toContain('opus-4-8');
    expect(insights.suggestions[0]).toContain('haiku');
  });
});
