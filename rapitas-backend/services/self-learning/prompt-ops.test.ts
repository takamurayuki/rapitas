/**
 * prompt-ops.test
 *
 * Verifies summarizePromptEvolution's pure grouping/aggregation logic against
 * fixture rows, and getPromptEvolutionSummary's thin Prisma-backed wrapper
 * against a mocked database. Never touches recordPromptEvolution /
 * getPromptEvolutionHistory — those are covered elsewhere and unchanged.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    promptEvolution: { findMany: mockFindMany },
  },
}));

const { summarizePromptEvolution, getPromptEvolutionSummary }: typeof import('./prompt-ops') =
  await import('./prompt-ops');

describe('summarizePromptEvolution', () => {
  it('returns an empty array for no rows', () => {
    expect(summarizePromptEvolution([])).toEqual([]);
  });

  it('groups by basePromptKey and counts pending vs completed', () => {
    const rows = [
      {
        id: 1,
        basePromptKey: 'workflow_role_planner',
        category: 'planning',
        status: 'pending',
        performanceDelta: 0,
        reason: 'success rate dropped',
        improvement: null,
        createdAt: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 2,
        basePromptKey: 'workflow_role_planner',
        category: 'planning',
        status: 'completed',
        performanceDelta: 0.2,
        reason: null,
        improvement: 'clearer checklist',
        createdAt: '2026-06-05T00:00:00.000Z',
      },
      {
        id: 3,
        basePromptKey: 'workflow_role_planner',
        category: 'planning',
        status: 'completed',
        performanceDelta: -0.1,
        reason: null,
        improvement: 'regressed',
        createdAt: '2026-06-03T00:00:00.000Z',
      },
    ];

    const summary = summarizePromptEvolution(rows);

    expect(summary).toHaveLength(1);
    const group = summary[0];
    expect(group.key).toBe('workflow_role_planner');
    expect(group.entryCount).toBe(3);
    expect(group.pendingCount).toBe(1);
    expect(group.completedCount).toBe(2);
    // Most recent completed row (id 2, 2026-06-05) is latest.
    expect(group.latestPerformanceDelta).toBe(0.2);
    // Average over completed rows: (0.2 + -0.1) / 2 = 0.05
    expect(group.averagePerformanceDelta).toBeCloseTo(0.05, 4);
    // recentEntries sorted newest-first across all statuses.
    expect(group.recentEntries.map((e) => e.id)).toEqual([2, 3, 1]);
  });

  it('falls back to category when basePromptKey is null (legacy rows)', () => {
    const rows = [
      {
        id: 10,
        basePromptKey: null,
        category: 'execution',
        status: 'completed',
        performanceDelta: 0.5,
        reason: null,
        improvement: 'legacy row',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    ];

    const summary = summarizePromptEvolution(rows);

    expect(summary).toHaveLength(1);
    expect(summary[0].key).toBe('execution');
    expect(summary[0].latestPerformanceDelta).toBe(0.5);
  });

  it('reports null latest/average performanceDelta when a group has only pending rows', () => {
    const rows = [
      {
        id: 20,
        basePromptKey: 'workflow_role_researcher',
        category: 'research',
        status: 'pending',
        performanceDelta: 0,
        reason: 'queued',
        improvement: null,
        createdAt: '2026-06-10T00:00:00.000Z',
      },
    ];

    const summary = summarizePromptEvolution(rows);

    expect(summary[0].pendingCount).toBe(1);
    expect(summary[0].completedCount).toBe(0);
    expect(summary[0].latestPerformanceDelta).toBeNull();
    expect(summary[0].averagePerformanceDelta).toBeNull();
  });

  it('orders groups by most recent activity first', () => {
    const rows = [
      {
        id: 30,
        basePromptKey: 'old_group',
        category: 'x',
        status: 'completed',
        performanceDelta: 0.1,
        reason: null,
        improvement: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 31,
        basePromptKey: 'new_group',
        category: 'y',
        status: 'completed',
        performanceDelta: 0.1,
        reason: null,
        improvement: null,
        createdAt: '2026-06-20T00:00:00.000Z',
      },
    ];

    const summary = summarizePromptEvolution(rows);

    expect(summary.map((g) => g.key)).toEqual(['new_group', 'old_group']);
  });

  it('caps recentEntries at the given recentLimit', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      basePromptKey: 'workflow_role_verifier',
      category: 'evaluation',
      status: 'completed',
      performanceDelta: 0,
      reason: null,
      improvement: null,
      createdAt: new Date(2026, 0, i + 1).toISOString(),
    }));

    const summary = summarizePromptEvolution(rows, 3);

    expect(summary[0].entryCount).toBe(8);
    expect(summary[0].recentEntries).toHaveLength(3);
  });
});

describe('getPromptEvolutionSummary', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('queries PromptEvolution and delegates to summarizePromptEvolution', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 1,
        basePromptKey: 'workflow_role_planner',
        category: 'planning',
        status: 'completed',
        performanceDelta: 0.3,
        reason: null,
        improvement: null,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);

    const summary = await getPromptEvolutionSummary();

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(summary).toHaveLength(1);
    expect(summary[0].key).toBe('workflow_role_planner');
    expect(summary[0].latestPerformanceDelta).toBe(0.3);
  });

  it('returns an empty array when no rows exist', async () => {
    mockFindMany.mockResolvedValue([]);

    const summary = await getPromptEvolutionSummary();

    expect(summary).toEqual([]);
  });
});
