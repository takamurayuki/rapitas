/**
 * decision-ledger/settle-filing.test
 *
 * Covers settling the decision to file a task. The rule under test is that
 * `correct` requires work that LANDED — 154 of 176 filings reached done in the
 * last 60 days, which says nothing about whether any were worth making.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const traceFindMany = mock((): Promise<{ id: number; nodeKey: string }[]> => Promise.resolve([]));
const traceUpdateMany = mock(() => Promise.resolve({ count: 1 }));
const taskFindUnique = mock(
  (): Promise<{ status: string } | null> => Promise.resolve({ status: 'done' }),
);
const prFindFirst = mock((): Promise<{ state: string } | null> => Promise.resolve(null));

mock.module('../../config/database', () => ({
  prisma: {
    agentDecisionTrace: { findMany: traceFindMany, updateMany: traceUpdateMany },
    task: { findUnique: taskFindUnique },
    gitHubPullRequest: { findFirst: prFindFirst },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { settleFilingDecisions } = await import('./settle-filing');

const FILING = { id: 91, nodeKey: 'task666:task-filing:1' };
const ROUTING = { id: 92, nodeKey: 'task666:model-route:1' };

/** The verdict written by the last updateMany call. */
function lastVerdict(): { consistency: string; consistencyNote: string } {
  const call = traceUpdateMany.mock.calls.at(-1)?.[0] as {
    data: { consistency: string; consistencyNote: string };
  };
  return call.data;
}

describe('settleFilingDecisions', () => {
  beforeEach(() => {
    traceFindMany.mockReset().mockResolvedValue([FILING]);
    traceUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    taskFindUnique.mockReset().mockResolvedValue({ status: 'done' });
    prFindFirst.mockReset().mockResolvedValue(null);
  });

  test('a filing whose work merged was worth making', async () => {
    prFindFirst.mockResolvedValue({ state: 'merged' });

    expect(await settleFilingDecisions(666)).toEqual({ checked: 1, settled: 1 });
    expect(lastVerdict().consistency).toBe('consistent');
  });

  test('done with nothing merged is unjudgeable, not a success', async () => {
    await settleFilingDecisions(666);

    // Closing a task is not evidence the filing was worth making.
    expect(lastVerdict().consistency).toBe('skipped');
  });

  test('a blocked task means the filing produced nothing', async () => {
    taskFindUnique.mockResolvedValue({ status: 'blocked' });

    await settleFilingDecisions(666);

    expect(lastVerdict().consistency).toBe('inconsistent');
  });

  test('a task still running settles nothing yet', async () => {
    taskFindUnique.mockResolvedValue({ status: 'in_progress' });

    expect(await settleFilingDecisions(666)).toEqual({ checked: 1, settled: 0 });
    expect(traceUpdateMany).not.toHaveBeenCalled();
  });

  test('leaves execution-backed decisions to their own checker', async () => {
    traceFindMany.mockResolvedValue([ROUTING]);

    expect(await settleFilingDecisions(666)).toEqual({ checked: 0, settled: 0 });
    expect(taskFindUnique).not.toHaveBeenCalled();
  });

  test('never throws into the task outcome', async () => {
    traceFindMany.mockRejectedValue(new Error('db down'));
    expect(await settleFilingDecisions(666)).toEqual({ checked: 0, settled: 0 });
  });
});
