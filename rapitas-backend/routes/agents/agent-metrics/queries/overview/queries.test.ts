/**
 * overview queries unit tests
 *
 * getMetricsOverview divided the exit-0 count by EVERY execution row, so the
 * 12 runs that were still running, interrupted or cancelled sat in the
 * denominator of a rate they belong to neither side of — 626 + 17 did not add
 * up to the 655 the card divided by (#1300). These tests pin the terminal-only
 * denominator and the explicit count of what it leaves out.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const execFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const configCount = mock((_args?: unknown) => Promise.resolve(0));
mock.module('../../../../../config/database', () => ({
  prisma: {
    agentExecution: { findMany: execFind },
    aIAgentConfig: { count: configCount },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

import { getMetricsOverview } from './queries';

function exec(status: string): Record<string, unknown> {
  return { status, tokensUsed: 0, executionTimeMs: null };
}

beforeEach(() => {
  execFind.mockReset();
  execFind.mockImplementation(() => Promise.resolve([]));
  configCount.mockReset();
  configCount.mockImplementation(() => Promise.resolve(0));
});

describe('getMetricsOverview', () => {
  test('divides the exit-0 rate by finished executions only', async () => {
    execFind.mockImplementation(() =>
      Promise.resolve([
        exec('completed'),
        exec('completed'),
        exec('completed'),
        exec('failed'),
        // Neither outcome: a run still going, one the user stopped and one the
        // process lost. None of these is a failure of the agent's work.
        exec('running'),
        exec('cancelled'),
        exec('interrupted'),
      ]),
    );

    const overview = await getMetricsOverview();

    expect(overview.totalSuccessful).toBe(3);
    expect(overview.totalFailed).toBe(1);
    expect(overview.overallSuccessRate).toBe(75);
  });

  test('reports what the denominator leaves out instead of dropping it', async () => {
    execFind.mockImplementation(() =>
      Promise.resolve([exec('completed'), exec('running'), exec('pending')]),
    );

    const overview = await getMetricsOverview();

    expect(overview.totalUnfinished).toBe(2);
    // Nothing disappears: the three buckets account for every row.
    expect(overview.totalSuccessful + overview.totalFailed + overview.totalUnfinished).toBe(
      overview.totalExecutions,
    );
  });

  test('rates an all-unfinished window at 0 rather than dividing by zero', async () => {
    execFind.mockImplementation(() => Promise.resolve([exec('running')]));

    const overview = await getMetricsOverview();

    expect(overview.overallSuccessRate).toBe(0);
    expect(overview.totalUnfinished).toBe(1);
  });
});
