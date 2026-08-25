/**
 * No-Change Completion Query テスト
 *
 * Exercises the pure aggregation (computeNoChangeCompletionStats) against
 * fixture completion/repair-bounce arrays, and the thin Prisma-backed
 * wrapper (getNoChangeCompletionStats) against a mocked database — mirroring
 * the mock.module-before-import pattern used by repair-convergence-query.test.ts
 * so the mock is in place before the module under test binds its `prisma` import.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    workflowTransition: { findMany: mockFindMany },
  },
}));

import {
  computeNoChangeCompletionStats,
  getNoChangeCompletionStats,
  type NoChangeCompletionRow,
  type RepairBounceRow,
} from '../../../routes/agents/agent-metrics/queries/no-change-completion-query';

describe('computeNoChangeCompletionStats', () => {
  it('returns all-zero stats when there are no confirmed no-change completions', () => {
    const stats = computeNoChangeCompletionStats([], []);

    expect(stats.totalConfirmedNoChange).toBe(0);
    expect(stats.immediateCount).toBe(0);
    expect(stats.afterRepairCount).toBe(0);
    expect(stats.immediateRate).toBe(0);
    expect(stats.byCause).toEqual([
      {
        cause: 'verify_no_change_confirmed',
        immediateCount: 0,
        afterRepairCount: 0,
        totalCount: 0,
      },
      {
        cause: 'research_no_change_complete',
        immediateCount: 0,
        afterRepairCount: 0,
        totalCount: 0,
      },
    ]);
  });

  it('classifies a completion with zero prior verify_repair bounces as immediate', () => {
    const completions: NoChangeCompletionRow[] = [
      {
        taskId: 590,
        cause: 'verify_no_change_confirmed',
        createdAt: '2026-08-20T00:10:00Z',
        id: 100,
      },
    ];
    const repairBounces: RepairBounceRow[] = [];

    const stats = computeNoChangeCompletionStats(completions, repairBounces);

    expect(stats.totalConfirmedNoChange).toBe(1);
    expect(stats.immediateCount).toBe(1);
    expect(stats.afterRepairCount).toBe(0);
    expect(stats.immediateRate).toBe(1);
  });

  it('classifies a completion with three prior verify_repair bounces as after-repair (task 603 shape)', () => {
    const completions: NoChangeCompletionRow[] = [
      {
        taskId: 603,
        cause: 'verify_no_change_confirmed',
        createdAt: '2026-08-20T05:00:00Z',
        id: 200,
      },
    ];
    const repairBounces: RepairBounceRow[] = [
      { taskId: 603, createdAt: '2026-08-20T01:00:00Z', id: 190 },
      { taskId: 603, createdAt: '2026-08-20T02:00:00Z', id: 195 },
      { taskId: 603, createdAt: '2026-08-20T03:00:00Z', id: 198 },
    ];

    const stats = computeNoChangeCompletionStats(completions, repairBounces);

    expect(stats.totalConfirmedNoChange).toBe(1);
    expect(stats.immediateCount).toBe(0);
    expect(stats.afterRepairCount).toBe(1);
  });

  it('separates verify_no_change_confirmed and research_no_change_complete into distinct byCause buckets', () => {
    const completions: NoChangeCompletionRow[] = [
      { taskId: 1, cause: 'verify_no_change_confirmed', createdAt: '2026-08-20T00:00:00Z', id: 1 },
      { taskId: 2, cause: 'research_no_change_complete', createdAt: '2026-08-20T00:00:00Z', id: 2 },
    ];
    const repairBounces: RepairBounceRow[] = [
      { taskId: 1, createdAt: '2026-08-19T23:00:00Z', id: 0 },
    ];

    const stats = computeNoChangeCompletionStats(completions, repairBounces);

    const verifyBucket = stats.byCause.find((b) => b.cause === 'verify_no_change_confirmed');
    const researchBucket = stats.byCause.find((b) => b.cause === 'research_no_change_complete');
    expect(verifyBucket).toEqual({
      cause: 'verify_no_change_confirmed',
      immediateCount: 0,
      afterRepairCount: 1,
      totalCount: 1,
    });
    expect(researchBucket).toEqual({
      cause: 'research_no_change_complete',
      immediateCount: 1,
      afterRepairCount: 0,
      totalCount: 1,
    });
  });

  it('breaks a same-millisecond tie by id, treating a lower-id repair bounce as prior', () => {
    const sameTimestamp = '2026-08-20T00:00:00.000Z';
    const completions: NoChangeCompletionRow[] = [
      { taskId: 7, cause: 'verify_no_change_confirmed', createdAt: sameTimestamp, id: 50 },
    ];
    const repairBounces: RepairBounceRow[] = [{ taskId: 7, createdAt: sameTimestamp, id: 49 }];

    const stats = computeNoChangeCompletionStats(completions, repairBounces);

    expect(stats.afterRepairCount).toBe(1);
    expect(stats.immediateCount).toBe(0);
  });

  it('does not let another task’s verify_repair bounces affect this task’s classification', () => {
    const completions: NoChangeCompletionRow[] = [
      {
        taskId: 11,
        cause: 'verify_no_change_confirmed',
        createdAt: '2026-08-20T02:00:00Z',
        id: 300,
      },
    ];
    const repairBounces: RepairBounceRow[] = [
      { taskId: 12, createdAt: '2026-08-20T01:00:00Z', id: 290 },
    ];

    const stats = computeNoChangeCompletionStats(completions, repairBounces);

    expect(stats.immediateCount).toBe(1);
    expect(stats.afterRepairCount).toBe(0);
  });

  it('classifies two completion events on the same task independently', () => {
    const completions: NoChangeCompletionRow[] = [
      {
        taskId: 20,
        cause: 'verify_no_change_confirmed',
        createdAt: '2026-08-20T01:00:00Z',
        id: 400,
      },
      {
        taskId: 20,
        cause: 'verify_no_change_confirmed',
        createdAt: '2026-08-20T05:00:00Z',
        id: 410,
      },
    ];
    const repairBounces: RepairBounceRow[] = [
      { taskId: 20, createdAt: '2026-08-20T03:00:00Z', id: 405 },
    ];

    const stats = computeNoChangeCompletionStats(completions, repairBounces);

    expect(stats.totalConfirmedNoChange).toBe(2);
    expect(stats.immediateCount).toBe(1);
    expect(stats.afterRepairCount).toBe(1);
  });
});

describe('getNoChangeCompletionStats', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('short-circuits without a second query when there are no confirmed no-change completions', async () => {
    mockFindMany.mockResolvedValue([]);

    const stats = await getNoChangeCompletionStats();

    expect(stats.totalConfirmedNoChange).toBe(0);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it('joins completion rows with verify_repair bounces and aggregates', async () => {
    mockFindMany
      .mockResolvedValueOnce([
        {
          taskId: 603,
          cause: 'verify_no_change_confirmed',
          createdAt: '2026-08-20T05:00:00Z',
          id: 200,
        },
      ])
      .mockResolvedValueOnce([{ taskId: 603, createdAt: '2026-08-20T01:00:00Z', id: 190 }]);

    const stats = await getNoChangeCompletionStats();

    expect(stats.totalConfirmedNoChange).toBe(1);
    expect(stats.afterRepairCount).toBe(1);
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });
});
