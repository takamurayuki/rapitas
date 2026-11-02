/**
 * first-pass-completion unit tests
 *
 * The /agents/metrics headline read "成功率 95.57%" while 36-53% of the tasks
 * completed in the same weeks had needed a verify_repair, because the number
 * counted CLI processes that exited 0 (#1300). These tests pin the task-level
 * replacement: of the tasks that FIRST completed inside the window, how many
 * got there with no verify_repair anywhere in their history.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const transitionFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
mock.module('../../../../../config/database', () => ({
  prisma: { workflowTransition: { findMany: transitionFind } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

import {
  countFirstPassCompletions,
  resolveRangeBounds,
  getFirstPassCompletion,
  type FirstPassTransitionRow,
} from './first-pass-completion';
import { buildDateWhereClause } from './queries';

/** Window the assertions below talk about: 10/17 00:00Z .. 10/24 00:00Z. */
const BOUNDS = {
  gte: new Date('2026-10-17T00:00:00Z'),
  lte: new Date('2026-10-24T00:00:00Z'),
};

const IN_WINDOW = new Date('2026-10-20T00:00:00Z');
const BEFORE_WINDOW = new Date('2026-10-01T00:00:00Z');
const AFTER_WINDOW = new Date('2026-10-30T00:00:00Z');

function row(overrides: Partial<FirstPassTransitionRow> = {}): FirstPassTransitionRow {
  return { taskId: 1, toStatus: null, cause: null, createdAt: IN_WINDOW, ...overrides };
}

beforeEach(() => {
  transitionFind.mockReset();
  transitionFind.mockImplementation(() => Promise.resolve([]));
});

describe('countFirstPassCompletions', () => {
  test('a task that completed in the window untouched by repair is first-pass', () => {
    const result = countFirstPassCompletions(
      [row({ toStatus: 'in_progress' }), row({ toStatus: 'completed' })],
      BOUNDS,
    );
    expect(result).toEqual({ completedTasks: 1, repairFreeTasks: 1, rate: 1 });
  });

  // The repair is usually recorded days before the completion it caused, so
  // reading only the window's own rows would call a repaired task first-pass.
  test('a verify_repair anywhere in the history disqualifies the task', () => {
    const result = countFirstPassCompletions(
      [row({ cause: 'verify_repair', createdAt: BEFORE_WINDOW }), row({ toStatus: 'completed' })],
      BOUNDS,
    );
    expect(result).toEqual({ completedTasks: 1, repairFreeTasks: 0, rate: 0 });
  });

  // Mirrors retro-kpi-metrics.ts, whose repairRate counts verify_repair alone.
  // Counting ci_repair too would make the two numbers incomparable, which is
  // the whole reason this metric exists.
  test('a ci_repair does not disqualify the task', () => {
    const result = countFirstPassCompletions(
      [row({ cause: 'ci_repair' }), row({ toStatus: 'completed' })],
      BOUNDS,
    );
    expect(result.repairFreeTasks).toBe(1);
  });

  // "First completion wins" (retro-kpi-metrics.ts:112): a re-opened and
  // re-completed task stays attributed to the week it first completed, so it
  // can never be counted in two windows.
  test('a task whose first completion predates the window is in no denominator', () => {
    const result = countFirstPassCompletions(
      [row({ toStatus: 'completed', createdAt: BEFORE_WINDOW }), row({ toStatus: 'completed' })],
      BOUNDS,
    );
    expect(result).toEqual({ completedTasks: 0, repairFreeTasks: 0, rate: null });
  });

  test('a task completed after the window is in no denominator', () => {
    const result = countFirstPassCompletions(
      [row({ toStatus: 'completed', createdAt: AFTER_WINDOW })],
      BOUNDS,
    );
    expect(result.completedTasks).toBe(0);
  });

  test('an unfinished task is in no denominator', () => {
    const result = countFirstPassCompletions(
      [row({ toStatus: 'in_progress' }), row({ cause: 'verify_repair' })],
      BOUNDS,
    );
    expect(result).toEqual({ completedTasks: 0, repairFreeTasks: 0, rate: null });
  });

  // The headline's whole defect was a rate that read as a verdict when it was
  // not measuring anything. An empty denominator must say "no data", the way
  // criticFirstPass already does — 0 would read as "everything needed repair".
  test('rate is null, not 0, when nothing completed in the window', () => {
    expect(countFirstPassCompletions([], BOUNDS).rate).toBeNull();
  });

  test('counts each task once however many transitions it has', () => {
    const result = countFirstPassCompletions(
      [
        row({ taskId: 1, toStatus: 'completed' }),
        row({ taskId: 1, toStatus: 'completed', createdAt: AFTER_WINDOW }),
        row({ taskId: 2, toStatus: 'completed' }),
        row({ taskId: 2, cause: 'verify_repair' }),
        row({ taskId: 3, toStatus: 'completed' }),
        row({ taskId: 3, cause: 'verify_repair' }),
      ],
      BOUNDS,
    );
    expect(result).toEqual({ completedTasks: 3, repairFreeTasks: 1, rate: 1 / 3 });
  });

  test('an open-ended window admits every completion', () => {
    const result = countFirstPassCompletions(
      [
        row({ taskId: 1, toStatus: 'completed', createdAt: BEFORE_WINDOW }),
        row({ taskId: 2, toStatus: 'completed', createdAt: AFTER_WINDOW }),
      ],
      {},
    );
    expect(result.completedTasks).toBe(2);
  });
});

describe('resolveRangeBounds', () => {
  // Both halves of the KPI card have to describe one window. buildDateWhereClause
  // filters the executions behind the exit-0 rate; resolveRangeBounds filters the
  // transitions behind the first-pass rate. If they ever drift, the card compares
  // two different periods and says nothing — so pin the equivalence here.
  test.each([
    ['both ends', { startDate: '2026-10-17', endDate: '2026-10-24' }],
    ['start only', { startDate: '2026-10-17' }],
    ['end only', { endDate: '2026-10-24' }],
  ])('matches buildDateWhereClause with %s', (_label, range) => {
    expect(resolveRangeBounds(range)).toEqual(buildDateWhereClause(range).createdAt);
  });

  test('leaves both ends open when no range was given', () => {
    expect(resolveRangeBounds()).toEqual({});
    expect(buildDateWhereClause().createdAt).toBeUndefined();
  });
});

describe('getFirstPassCompletion', () => {
  test('reads the completing tasks full history, not just the window', async () => {
    transitionFind.mockImplementationOnce(() => Promise.resolve([{ taskId: 7 }]));
    transitionFind.mockImplementationOnce(() =>
      Promise.resolve([
        { taskId: 7, toStatus: 'completed', cause: null, createdAt: IN_WINDOW },
        { taskId: 7, toStatus: null, cause: 'verify_repair', createdAt: BEFORE_WINDOW },
      ]),
    );

    const result = await getFirstPassCompletion({
      startDate: '2026-10-17',
      endDate: '2026-10-24',
    });

    // The repair predates the window, so an in-window-only history read would
    // have reported 1/1 first-pass here.
    expect(result).toEqual({ completedTasks: 1, repairFreeTasks: 0, rate: 0 });
    const historyQuery = transitionFind.mock.calls[1]?.[0] as { where?: Record<string, unknown> };
    expect(historyQuery?.where).toEqual({ taskId: { in: [7] } });
  });

  test('does not query a history when nothing completed in the window', async () => {
    const result = await getFirstPassCompletion({ startDate: '2026-10-17' });
    expect(result).toEqual({ completedTasks: 0, repairFreeTasks: 0, rate: null });
    expect(transitionFind).toHaveBeenCalledTimes(1);
  });
});
