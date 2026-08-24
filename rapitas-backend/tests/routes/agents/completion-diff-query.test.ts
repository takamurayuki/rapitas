/**
 * Completion Diff Query テスト
 *
 * Exercises the pure classification (computeCompletionDiffStats) against
 * fixture task/activity-log arrays, and the thin Prisma-backed wrapper
 * (getCompletionDiffStats) against a mocked database — mirroring the
 * mock.module-before-import pattern used by repair-convergence-query.test.ts
 * so the mock is in place before the module under test binds its `prisma`
 * import.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockTaskFindMany = mock(() => Promise.resolve([] as unknown[]));
const mockActivityLogFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: { findMany: mockTaskFindMany },
    activityLog: { findMany: mockActivityLogFindMany },
  },
}));

import {
  computeCompletionDiffStats,
  getCompletionDiffStats,
  type CompletionDiffTaskInput,
  type CompletionDiffActivityLogInput,
} from '../../../routes/agents/agent-metrics/queries/completion-diff-query';

const COMPLETED_AT = new Date('2026-08-24T10:00:00.000Z');

function task(taskId: number, title = `task-${taskId}`): CompletionDiffTaskInput {
  return { taskId, title, completedAt: COMPLETED_AT };
}

function commitLog(
  taskId: number,
  logId: number,
  metadata: Record<string, unknown> | string | null,
  createdAt = new Date('2026-08-24T09:00:00.000Z'),
): CompletionDiffActivityLogInput {
  return {
    taskId,
    logId,
    createdAt,
    metadata:
      typeof metadata === 'string' || metadata === null ? metadata : JSON.stringify(metadata),
  };
}

describe('computeCompletionDiffStats', () => {
  it('returns all-zero stats for empty input', () => {
    const stats = computeCompletionDiffStats([], []);

    expect(stats.totalCompletions).toBe(0);
    expect(stats.hasDiffCount).toBe(0);
    expect(stats.zeroDiffCount).toBe(0);
    expect(stats.unknownCount).toBe(0);
    expect(stats.zeroDiffRate).toBe(0);
    expect(stats.entries).toEqual([]);
  });

  it('classifies a completion whose log reports filesChanged=6 as has_diff', () => {
    const stats = computeCompletionDiffStats(
      [task(589)],
      [
        commitLog(589, 1, {
          filesChanged: 6,
          additions: 996,
          deletions: 12,
          alreadyCommitted: false,
        }),
      ],
    );

    expect(stats.entries[0].classification).toBe('has_diff');
    expect(stats.entries[0].filesChanged).toBe(6);
    expect(stats.entries[0].additions).toBe(996);
    expect(stats.hasDiffCount).toBe(1);
  });

  it('classifies a completion whose log reports filesChanged=0 as zero_diff', () => {
    const stats = computeCompletionDiffStats(
      [task(603)],
      [commitLog(603, 2, { filesChanged: 0, additions: 0, deletions: 0, alreadyCommitted: false })],
    );

    expect(stats.entries[0].classification).toBe('zero_diff');
    expect(stats.entries[0].filesChanged).toBe(0);
    expect(stats.zeroDiffCount).toBe(1);
  });

  it('classifies a completion with no matching ActivityLog row as unknown', () => {
    const stats = computeCompletionDiffStats([task(590)], []);

    expect(stats.entries[0].classification).toBe('unknown');
    expect(stats.entries[0].filesChanged).toBeNull();
    expect(stats.entries[0].additions).toBeNull();
    expect(stats.unknownCount).toBe(1);
  });

  it('classifies a completion whose log metadata is invalid JSON as unknown', () => {
    const stats = computeCompletionDiffStats([task(7)], [commitLog(7, 3, '{not-json')]);

    expect(stats.entries[0].classification).toBe('unknown');
    expect(stats.entries[0].filesChanged).toBeNull();
  });

  it('picks the latest of multiple auto-commit rows by createdAt (id as tiebreaker)', () => {
    // Earlier attempt reported zero diff; the later one landed 9 files. The
    // strict toBe(9) assertion (not just classification) guards the sort keys.
    const stats = computeCompletionDiffStats(
      [task(647)],
      [
        commitLog(
          647,
          10,
          { filesChanged: 0, additions: 0, deletions: 0 },
          new Date('2026-08-24T08:00:00.000Z'),
        ),
        commitLog(
          647,
          11,
          { filesChanged: 9, additions: 628, deletions: 40 },
          new Date('2026-08-24T08:30:00.000Z'),
        ),
      ],
    );

    expect(stats.entries[0].filesChanged).toBe(9);
    expect(stats.entries[0].classification).toBe('has_diff');
  });

  it('uses id as the second sort key when createdAt is identical', () => {
    const sameInstant = new Date('2026-08-24T08:00:00.000Z');
    const stats = computeCompletionDiffStats(
      [task(648)],
      [
        commitLog(648, 21, { filesChanged: 9 }, sameInstant),
        commitLog(648, 20, { filesChanged: 0 }, sameInstant),
      ],
    );

    expect(stats.entries[0].filesChanged).toBe(9);
    expect(stats.entries[0].classification).toBe('has_diff');
  });

  it('treats alreadyCommitted=true with filesChanged=18 as has_diff and keeps the flag', () => {
    const stats = computeCompletionDiffStats(
      [task(588)],
      [
        commitLog(588, 4, {
          filesChanged: 18,
          additions: 2228,
          deletions: 100,
          alreadyCommitted: true,
        }),
      ],
    );

    expect(stats.entries[0].classification).toBe('has_diff');
    expect(stats.entries[0].alreadyCommitted).toBe(true);
  });

  it('classifies a negative filesChanged as unknown (defensive)', () => {
    const stats = computeCompletionDiffStats([task(8)], [commitLog(8, 5, { filesChanged: -1 })]);

    expect(stats.entries[0].classification).toBe('unknown');
    expect(stats.entries[0].filesChanged).toBeNull();
  });

  it('aggregates mixed data into counts and zeroDiffRate', () => {
    const stats = computeCompletionDiffStats(
      [task(1), task(2), task(3), task(4)],
      [
        commitLog(1, 30, { filesChanged: 6 }),
        commitLog(2, 31, { filesChanged: 3 }),
        commitLog(3, 32, { filesChanged: 0 }),
        // task 4 has no log row -> unknown
      ],
    );

    expect(stats.totalCompletions).toBe(4);
    expect(stats.hasDiffCount).toBe(2);
    expect(stats.zeroDiffCount).toBe(1);
    expect(stats.unknownCount).toBe(1);
    expect(stats.zeroDiffRate).toBeCloseTo(0.25, 4);
  });
});

describe('getCompletionDiffStats', () => {
  beforeEach(() => {
    mockTaskFindMany.mockReset();
    mockActivityLogFindMany.mockReset();
  });

  it('short-circuits to empty stats without querying ActivityLog when no completions exist', async () => {
    mockTaskFindMany.mockResolvedValue([]);

    const stats = await getCompletionDiffStats();

    expect(stats.totalCompletions).toBe(0);
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
  });

  it('passes the limit through to task.findMany as take', async () => {
    mockTaskFindMany.mockResolvedValue([]);

    await getCompletionDiffStats(50);

    expect(mockTaskFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('joins completed tasks with their auto-commit logs and aggregates', async () => {
    mockTaskFindMany.mockResolvedValue([
      { id: 589, title: 'landing task', completedAt: COMPLETED_AT },
      { id: 590, title: 'meta task', completedAt: COMPLETED_AT },
    ]);
    mockActivityLogFindMany.mockResolvedValue([
      {
        id: 100,
        taskId: 589,
        createdAt: new Date('2026-08-24T09:00:00.000Z'),
        metadata: JSON.stringify({
          filesChanged: 6,
          additions: 996,
          deletions: 12,
          alreadyCommitted: false,
        }),
      },
    ]);

    const stats = await getCompletionDiffStats();

    expect(stats.totalCompletions).toBe(2);
    expect(stats.hasDiffCount).toBe(1);
    expect(stats.unknownCount).toBe(1);
    const landed = stats.entries.find((e) => e.taskId === 589);
    expect(landed?.classification).toBe('has_diff');
    expect(landed?.filesChanged).toBe(6);
  });
});
