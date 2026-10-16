/**
 * pareto-dominance unit tests
 *
 * Verifies strict dominance, the all-non-dominated case, identical points,
 * single-point segments, and that unreliable points neither dominate nor
 * appear on the frontier.
 */
import { describe, test, expect } from 'bun:test';
import { dominates, markParetoOptimal } from './pareto-dominance';
import type { ParetoPoint } from './pareto-frontier-types';

/** Builds a reliable point with flat CIs from its three objective values. */
function point(
  key: string,
  time: number,
  success: number,
  cost: number,
  overrides: Partial<ParetoPoint> = {},
): ParetoPoint {
  return {
    key,
    parameterSet: { role: 'implementer', model: key },
    sampleSize: 10,
    successCount: Math.round(success / 10),
    reliable: true,
    paretoOptimal: false,
    avgTokens: 0,
    successRate: { value: success, ciLow: success, ciHigh: success },
    executionTimeMs: { value: time, ciLow: time, ciHigh: time },
    costUsd: { value: cost, ciLow: cost, ciHigh: cost },
    ...overrides,
  };
}

describe('dominates', () => {
  test('requires no-worse on all objectives and strictly better on one', () => {
    const a = { time: 100, success: 90, cost: 1 };
    expect(dominates(a, { time: 200, success: 90, cost: 1 })).toBe(true);
    expect(dominates(a, { time: 100, success: 80, cost: 1 })).toBe(true);
    expect(dominates(a, { time: 100, success: 90, cost: 2 })).toBe(true);
    expect(dominates(a, { time: 50, success: 95, cost: 2 })).toBe(false);
  });

  test('identical objectives never dominate each other', () => {
    const a = { time: 100, success: 90, cost: 1 };
    expect(dominates(a, { ...a })).toBe(false);
  });
});

describe('markParetoOptimal', () => {
  test('marks only the non-dominated points', () => {
    const fast = point('fast', 100, 80, 2);
    const accurate = point('accurate', 300, 95, 3);
    const dominated = point('dominated', 400, 90, 4);
    const result = markParetoOptimal([fast, accurate, dominated]);
    expect(result.map((p) => [p.key, p.paretoOptimal])).toEqual([
      ['fast', true],
      ['accurate', true],
      ['dominated', false],
    ]);
  });

  test('keeps every point when none dominates another', () => {
    const result = markParetoOptimal([
      point('a', 100, 80, 3),
      point('b', 200, 90, 2),
      point('c', 300, 95, 1),
    ]);
    expect(result.every((p) => p.paretoOptimal)).toBe(true);
  });

  test('a single reliable point is optimal; identical points both stay optimal', () => {
    expect(markParetoOptimal([point('solo', 100, 90, 1)])[0].paretoOptimal).toBe(true);
    const twins = markParetoOptimal([point('x', 100, 90, 1), point('y', 100, 90, 1)]);
    expect(twins.map((p) => p.paretoOptimal)).toEqual([true, true]);
  });

  test('unreliable points are never optimal and cannot dominate reliable ones', () => {
    const weak = point('weak', 10, 100, 0.01, { reliable: false, sampleSize: 2 });
    const solid = point('solid', 500, 80, 5);
    const result = markParetoOptimal([weak, solid]);
    expect(result.find((p) => p.key === 'weak')?.paretoOptimal).toBe(false);
    expect(result.find((p) => p.key === 'solid')?.paretoOptimal).toBe(true);
  });

  test('does not mutate its input', () => {
    const input = [point('a', 100, 90, 1)];
    markParetoOptimal(input);
    expect(input[0].paretoOptimal).toBe(false);
  });
});
