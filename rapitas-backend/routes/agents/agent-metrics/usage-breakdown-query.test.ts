/**
 * usage-breakdown-query unit tests
 *
 * Verifies role normalization, per-role aggregation (cost/tokens/cache/failure),
 * cost-share math, daily bucket pre-seeding, and defensive coercion of legacy
 * double-JSON-encoded costUsd values.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const findMany = mock(() => Promise.resolve([] as unknown[]));
mock.module('../../../config/database', () => ({
  prisma: {
    agentExecution: { findMany },
  },
}));

import { getAgentUsageBreakdown, normalizeRole } from './usage-breakdown-query';

/** Build a minimal execution row for the mocked findMany. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startedAt: new Date(),
    createdAt: new Date(),
    status: 'completed',
    errorMessage: null,
    executionTimeMs: 1000,
    inputTokens: 100,
    outputTokens: 200,
    cacheReadInputTokens: 900,
    cacheCreationInputTokens: 50,
    costUsd: 1.5,
    llmCallCount: 3,
    session: { mode: 'workflow-implementer' },
    ...overrides,
  };
}

beforeEach(() => {
  findMany.mockReset();
  findMany.mockImplementation(() => Promise.resolve([]));
});

describe('normalizeRole', () => {
  test('strips the workflow- prefix', () => {
    expect(normalizeRole('workflow-researcher')).toBe('researcher');
    expect(normalizeRole('workflow-auto_verifier')).toBe('auto_verifier');
  });

  test('maps null/undefined to other, keeps non-workflow modes as-is', () => {
    expect(normalizeRole(null)).toBe('other');
    expect(normalizeRole(undefined)).toBe('other');
    expect(normalizeRole('single')).toBe('single');
  });
});

describe('getAgentUsageBreakdown', () => {
  test('returns empty roles and pre-seeded daily buckets when no executions', async () => {
    const result = await getAgentUsageBreakdown(7);
    expect(result.windowDays).toBe(7);
    expect(result.totalExecutions).toBe(0);
    expect(result.totalCostUsd).toBe(0);
    expect(result.roles).toEqual([]);
    expect(result.dailyRoleCost).toHaveLength(7);
    expect(result.dailyRoleCost.every((d) => d.totalCostUsd === 0)).toBe(true);
  });

  test('aggregates cost/tokens/failures per role and computes shares', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([
        row({ costUsd: 3, session: { mode: 'workflow-implementer' } }),
        row({ costUsd: 1, session: { mode: 'workflow-implementer' }, status: 'failed' }),
        row({ costUsd: 1, session: { mode: 'workflow-researcher' } }),
      ]),
    );

    const result = await getAgentUsageBreakdown(7);
    expect(result.totalExecutions).toBe(3);
    expect(result.totalCostUsd).toBe(5);

    const implementer = result.roles.find((r) => r.role === 'implementer');
    expect(implementer).toBeDefined();
    expect(implementer!.executions).toBe(2);
    expect(implementer!.failedExecutions).toBe(1);
    expect(implementer!.costUsd).toBe(4);
    expect(implementer!.shareOfCost).toBe(0.8);
    expect(implementer!.outputTokens).toBe(400);
    // cache_read / (cache_read + input) = 1800 / (1800 + 200)
    expect(implementer!.cacheHitRate).toBe(0.9);
    expect(implementer!.averageExecutionTimeMs).toBe(1000);

    // Known-role pipeline order: researcher before implementer.
    expect(result.roles.map((r) => r.role)).toEqual(['researcher', 'implementer']);
  });

  test('buckets daily cost by role on the execution start date', async () => {
    const today = new Date();
    findMany.mockImplementation(() =>
      Promise.resolve([
        row({ costUsd: 2, startedAt: today }),
        row({ costUsd: 1, startedAt: today, session: { mode: 'workflow-verifier' } }),
      ]),
    );

    const result = await getAgentUsageBreakdown(3);
    const todayKey = today.toISOString().slice(0, 10);
    const bucket = result.dailyRoleCost.find((d) => d.date === todayKey);
    expect(bucket).toBeDefined();
    expect(bucket!.totalCostUsd).toBe(3);
    expect(bucket!.byRole).toEqual({ implementer: 2, verifier: 1 });
  });

  test('coerces legacy double-JSON-encoded costUsd strings', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([row({ costUsd: '"2.5"' }), row({ costUsd: 'not-a-number' })]),
    );

    const result = await getAgentUsageBreakdown(7);
    expect(result.totalCostUsd).toBe(2.5);
  });

  test('groups null-session and null-mode executions under other', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([row({ session: null, costUsd: 1 }), row({ session: { mode: null } })]),
    );

    const result = await getAgentUsageBreakdown(7);
    expect(result.roles).toHaveLength(1);
    expect(result.roles[0].role).toBe('other');
    expect(result.roles[0].executions).toBe(2);
  });
});
