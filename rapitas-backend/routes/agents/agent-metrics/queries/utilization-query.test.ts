/**
 * utilization-query unit tests
 *
 * Verifies the union-based busy-ratio math: overlapping same-role executions
 * counted once (≤1), midnight-spanning intervals clipped per UTC day, null
 * startedAt reconstruction, in-flight exclusion, empty-window pre-seeding, and
 * date-range bucket alignment.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const findMany = mock(() => Promise.resolve([] as unknown[]));
mock.module('../../../../config/database', () => ({
  prisma: {
    agentExecution: { findMany },
  },
}));

import { getAgentUtilization, unionLength } from './utilization-query';

const RANGE = { startDate: '2026-08-01', endDate: '2026-08-07' };

/** Build a minimal execution row for the mocked findMany. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startedAt: new Date('2026-08-02T06:00:00.000Z'),
    completedAt: new Date('2026-08-02T12:00:00.000Z'),
    executionTimeMs: 6 * 3_600_000,
    modelName: 'claude-sonnet-4-6',
    session: { mode: 'workflow-implementer' },
    agentConfig: { agentType: 'claude-code' },
    ...overrides,
  };
}

beforeEach(() => {
  findMany.mockReset();
  findMany.mockImplementation(() => Promise.resolve([]));
});

describe('unionLength', () => {
  test('merges overlapping intervals instead of summing them', () => {
    // [0,10] and [5,15] cover 15, not 20.
    expect(
      unionLength(
        [
          [0, 10],
          [5, 15],
        ],
        0,
        100,
      ),
    ).toBe(15);
  });

  test('clips to the window and ignores intervals fully outside it', () => {
    expect(
      unionLength(
        [
          [-10, 5],
          [90, 200],
          [300, 400],
        ],
        0,
        100,
      ),
    ).toBe(15);
  });

  test('returns 0 for no intervals', () => {
    expect(unionLength([], 0, 100)).toBe(0);
  });
});

describe('getAgentUtilization', () => {
  test('two overlapping same-role executions count once (union < sum, value ≤ 1)', async () => {
    // 00:00-12:00 and 06:00-18:00 on Aug 2 → union 18h (0.75), sum would be 24h (1.0).
    findMany.mockImplementation(() =>
      Promise.resolve([
        row({
          startedAt: new Date('2026-08-02T00:00:00.000Z'),
          completedAt: new Date('2026-08-02T12:00:00.000Z'),
        }),
        row({
          startedAt: new Date('2026-08-02T06:00:00.000Z'),
          completedAt: new Date('2026-08-02T18:00:00.000Z'),
        }),
      ]),
    );

    const result = await getAgentUtilization(RANGE);
    const day = result.daily.find((d) => d.date === '2026-08-02');
    expect(day).toBeDefined();
    expect(day!.byRole.implementer).toBe(0.75);
    expect(day!.byRole.implementer).toBeLessThanOrEqual(1);
    expect(day!.byAgent['claude-code']).toBe(0.75);
  });

  test('a midnight-spanning execution is clipped into each UTC day', async () => {
    // Aug 2 18:00 → Aug 3 06:00: 6h on each side (0.25 / 0.25).
    findMany.mockImplementation(() =>
      Promise.resolve([
        row({
          startedAt: new Date('2026-08-02T18:00:00.000Z'),
          completedAt: new Date('2026-08-03T06:00:00.000Z'),
        }),
      ]),
    );

    const result = await getAgentUtilization(RANGE);
    expect(result.daily.find((d) => d.date === '2026-08-02')!.byRole.implementer).toBe(0.25);
    expect(result.daily.find((d) => d.date === '2026-08-03')!.byRole.implementer).toBe(0.25);
    expect(result.daily.find((d) => d.date === '2026-08-04')!.byRole.implementer).toBe(0);
  });

  test('null startedAt is reconstructed from completedAt − executionTimeMs', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([
        row({
          startedAt: null,
          completedAt: new Date('2026-08-05T12:00:00.000Z'),
          executionTimeMs: 6 * 3_600_000,
        }),
      ]),
    );

    const result = await getAgentUtilization(RANGE);
    expect(result.daily.find((d) => d.date === '2026-08-05')!.byRole.implementer).toBe(0.25);
  });

  test('in-flight (completedAt null) and underivable rows are excluded', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([
        row({ completedAt: null }),
        // No startedAt and no executionTimeMs → interval underivable.
        row({ startedAt: null, executionTimeMs: null }),
        // Negative-length interval → invalid.
        row({
          startedAt: new Date('2026-08-02T12:00:00.000Z'),
          completedAt: new Date('2026-08-02T06:00:00.000Z'),
        }),
      ]),
    );

    const result = await getAgentUtilization(RANGE);
    expect(result.roles).toEqual([]);
    expect(result.agents).toEqual([]);
  });

  test('empty data yields pre-seeded days with no series', async () => {
    const result = await getAgentUtilization(RANGE);
    expect(result.daily).toHaveLength(7);
    expect(result.daily.every((d) => Object.keys(d.byRole).length === 0)).toBe(true);
    expect(result.roles).toEqual([]);
  });

  test('day buckets align with the requested range and dayCount', async () => {
    findMany.mockImplementation(() => Promise.resolve([row()]));

    const result = await getAgentUtilization(RANGE);
    expect(result.startDate).toBe('2026-08-01');
    expect(result.endDate).toBe('2026-08-07');
    expect(result.dayCount).toBe(7);
    expect(result.daily).toHaveLength(7);
    expect(result.daily[0].date).toBe('2026-08-01');
    expect(result.daily[6].date).toBe('2026-08-07');
    // A role seen in the window is present on every day (0 when idle).
    expect(result.daily.every((d) => typeof d.byRole.implementer === 'number')).toBe(true);
  });

  test('window summary unions across the whole window', async () => {
    // 12h on Aug 2 + 12h on Aug 4 = 24h busy over a 7-day window.
    findMany.mockImplementation(() =>
      Promise.resolve([
        row({
          startedAt: new Date('2026-08-02T00:00:00.000Z'),
          completedAt: new Date('2026-08-02T12:00:00.000Z'),
        }),
        row({
          startedAt: new Date('2026-08-04T00:00:00.000Z'),
          completedAt: new Date('2026-08-04T12:00:00.000Z'),
        }),
      ]),
    );

    const result = await getAgentUtilization(RANGE);
    expect(result.roles).toHaveLength(1);
    expect(result.roles[0].role).toBe('implementer');
    expect(result.roles[0].utilization).toBe(round4(1 / 7));
    expect(result.agents[0].agent).toBe('claude-code');
    expect(result.agents[0].utilization).toBe(round4(1 / 7));
  });

  test('defaults to a trailing 7-day window when no range is given', async () => {
    const result = await getAgentUtilization();
    expect(result.dayCount).toBe(7);
    expect(result.daily).toHaveLength(7);
    const todayKey = new Date().toISOString().slice(0, 10);
    expect(result.endDate).toBe(todayKey);
  });
});

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
