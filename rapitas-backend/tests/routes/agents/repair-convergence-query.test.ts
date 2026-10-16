/**
 * Repair Convergence Query テスト
 *
 * Exercises the pure aggregation (computeRepairConvergenceStats) against
 * fixture transition/status arrays, and the thin Prisma-backed wrapper
 * (getRepairConvergenceStats) against a mocked database — mirroring the
 * mock.module-before-import pattern used by observation-query.test.ts so the
 * mock is in place before the module under test binds its `prisma` import.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockTransitionFindMany = mock(() => Promise.resolve([] as unknown[]));
const mockTaskFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    workflowTransition: { findMany: mockTransitionFindMany },
    task: { findMany: mockTaskFindMany },
  },
}));

import {
  computeRepairConvergenceStats,
  getRepairConvergenceStats,
  type RepairTransitionRow,
  type TaskFinalState,
} from '../../../routes/agents/agent-metrics/queries/repair-convergence-query';

describe('computeRepairConvergenceStats', () => {
  it('returns all-zero stats when no task ever entered the repair loop', () => {
    const stats = computeRepairConvergenceStats([], []);

    expect(stats.tasksEnteredRepairLoop).toBe(0);
    expect(stats.convergedCount).toBe(0);
    expect(stats.blockedCount).toBe(0);
    expect(stats.pendingCount).toBe(0);
    expect(stats.convergenceRate).toBe(0);
    expect(stats.averageIterationsToConvergence).toBeNull();
    expect(stats.iterationDistribution).toEqual([]);
  });

  it('classifies converged / blocked / pending tasks and averages iterations to convergence', () => {
    const repairTransitions: RepairTransitionRow[] = [
      { taskId: 1, cause: 'verify_repair' },
      { taskId: 1, cause: 'verify_repair' }, // task 1: 2 verify_repair bounces, converged
      { taskId: 2, cause: 'verify_repair' }, // task 2: 1 bounce, stayed blocked
      { taskId: 3, cause: 'ci_repair' },
      { taskId: 3, cause: 'ci_repair' },
      { taskId: 3, cause: 'ci_repair' }, // task 3: 3 ci_repair bounces, converged
      { taskId: 4, cause: 'verify_repair' }, // task 4: 1 bounce, still running
    ];
    const taskStatuses: TaskFinalState[] = [
      { taskId: 1, status: 'completed' },
      { taskId: 2, status: 'blocked' },
      { taskId: 3, status: 'completed' },
      { taskId: 4, status: 'in-progress' },
    ];

    const stats = computeRepairConvergenceStats(repairTransitions, taskStatuses);

    expect(stats.tasksEnteredRepairLoop).toBe(4);
    expect(stats.convergedCount).toBe(2);
    expect(stats.blockedCount).toBe(1);
    expect(stats.pendingCount).toBe(1);
    expect(stats.convergenceRate).toBeCloseTo(0.5, 4);
    // Converged tasks needed 2 and 3 iterations -> average 2.5
    expect(stats.averageIterationsToConvergence).toBeCloseTo(2.5, 2);

    expect(stats.iterationDistribution).toEqual([
      { iterations: 1, taskCount: 2 }, // task 2 and task 4 each needed 1 bounce
      { iterations: 2, taskCount: 1 }, // task 1
      { iterations: 3, taskCount: 1 }, // task 3
    ]);

    const verifyBreakdown = stats.attemptsByCause.find((c) => c.cause === 'verify_repair');
    const ciBreakdown = stats.attemptsByCause.find((c) => c.cause === 'ci_repair');
    expect(verifyBreakdown).toEqual({
      cause: 'verify_repair',
      totalAttempts: 4,
      tasksAffected: 3,
    });
    expect(ciBreakdown).toEqual({ cause: 'ci_repair', totalAttempts: 3, tasksAffected: 1 });
  });

  it('treats a task missing from the status list as pending, not converged', () => {
    const stats = computeRepairConvergenceStats([{ taskId: 9, cause: 'verify_repair' }], []);

    expect(stats.tasksEnteredRepairLoop).toBe(1);
    expect(stats.convergedCount).toBe(0);
    expect(stats.pendingCount).toBe(1);
  });

  // task 798: identified/unidentified is derived read-only from data
  // verify-self-repair.ts already records (metadata.reason) matched against
  // Task.acceptanceCriteria via the same identifyIndictedCriteria the repair
  // loop's own cutoff uses — no change to the protected repair-loop module.
  it('splits verify_repair rows into identified/unidentified via reason-vs-criteria matching (task 798)', () => {
    const criteria = JSON.stringify(['`detectRepeatLoop` が bounce 回数を検証する']);
    const repairTransitions: RepairTransitionRow[] = [
      // task 1: reason cites the criterion's backtick identifier -> identified.
      {
        taskId: 1,
        cause: 'verify_repair',
        metadata: JSON.stringify({ reason: 'detectRepeatLoop の検証が不足している' }),
      },
      // task 1: generic reason, no number/token match -> unidentified.
      {
        taskId: 1,
        cause: 'verify_repair',
        metadata: JSON.stringify({ reason: '受入基準を満たしていません' }),
      },
      // task 2: same generic reason -> unidentified.
      {
        taskId: 2,
        cause: 'verify_repair',
        metadata: JSON.stringify({ reason: '受入基準を満たしていません' }),
      },
      // task 3: has criteria but metadata predates the `reason` field -> excluded (no signal).
      { taskId: 3, cause: 'verify_repair', metadata: JSON.stringify({ attempt: 1 }) },
      // ci_repair rows carry no acceptance-criteria reasoning -> excluded from both buckets.
      { taskId: 4, cause: 'ci_repair', metadata: JSON.stringify({ reason: 'CI failed' }) },
    ];
    const taskStatuses: TaskFinalState[] = [
      { taskId: 1, status: 'in-progress', acceptanceCriteria: criteria },
      { taskId: 2, status: 'in-progress', acceptanceCriteria: criteria },
      { taskId: 3, status: 'in-progress', acceptanceCriteria: criteria },
      { taskId: 4, status: 'in-progress', acceptanceCriteria: criteria },
    ];

    const stats = computeRepairConvergenceStats(repairTransitions, taskStatuses);

    expect(stats.verifyRepairIdentifiedCount).toBe(1);
    expect(stats.verifyRepairUnidentifiedCount).toBe(2);
    expect(stats.verifyRepairUnidentifiedRate).toBeCloseTo(2 / 3, 4);
  });

  it('returns rate 0 when no verify_repair row can be classified (no criteria / no reason)', () => {
    const stats = computeRepairConvergenceStats(
      [
        { taskId: 1, cause: 'verify_repair', metadata: null },
        { taskId: 2, cause: 'verify_repair', metadata: JSON.stringify({ reason: 'fail' }) },
      ],
      [{ taskId: 2, status: 'in-progress', acceptanceCriteria: null }],
    );

    expect(stats.verifyRepairIdentifiedCount).toBe(0);
    expect(stats.verifyRepairUnidentifiedCount).toBe(0);
    expect(stats.verifyRepairUnidentifiedRate).toBe(0);
  });
});

describe('getRepairConvergenceStats', () => {
  beforeEach(() => {
    mockTransitionFindMany.mockReset();
    mockTaskFindMany.mockReset();
  });

  it('joins repair transitions with task status and aggregates', async () => {
    mockTransitionFindMany.mockResolvedValue([
      { taskId: 10, cause: 'verify_repair' },
      { taskId: 10, cause: 'verify_repair' },
    ]);
    mockTaskFindMany.mockResolvedValue([{ id: 10, status: 'completed' }]);

    const stats = await getRepairConvergenceStats();

    expect(stats.tasksEnteredRepairLoop).toBe(1);
    expect(stats.convergedCount).toBe(1);
    expect(stats.averageIterationsToConvergence).toBe(2);
  });

  it('short-circuits to empty stats without querying tasks when no repair transitions exist', async () => {
    mockTransitionFindMany.mockResolvedValue([]);

    const stats = await getRepairConvergenceStats();

    expect(stats.tasksEnteredRepairLoop).toBe(0);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
  });
});
