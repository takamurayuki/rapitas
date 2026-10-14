/**
 * usage-budget-math unit tests
 *
 * Pins the plan's formulas: integer threshold comparison at 79/80/89/90/99/100%,
 * the 7-day average denominator, month/day boundaries under a timezone offset,
 * unit switching, share validation and the suggested initial shares.
 */
import { describe, test, expect } from 'bun:test';
import {
  parseTzOffset,
  localDateKey,
  monthKey,
  monthWindow,
  resolveExecutionTokens,
  determineLevel,
  computeAvg7,
  computeProjection,
  suggestShares,
  validateShares,
  validateMonthlyLimit,
  sampleUsage,
  shouldPrompt,
  levelKey,
} from './usage-budget-math';
import type { BudgetConfig, ExecutionUsageSample } from './usage-budget-types';

function sample(at: string, tokens = 100, themeId = 1): ExecutionUsageSample {
  return { at: new Date(at), tokens, durationMs: 1000, costUsd: 0, themeId };
}

describe('determineLevel', () => {
  test.each([
    [79, 'none'],
    [80, 'warn80'],
    [89, 'warn80'],
    [90, 'warn90'],
    [99, 'warn90'],
    [100, 'exceeded'],
    [150, 'exceeded'],
  ])('%d of 100 → %s', (used, expected) => {
    expect(determineLevel(used, 100)).toBe(expected as ReturnType<typeof determineLevel>);
  });

  test('uses integer comparison so 0.1-style float error cannot shift a level', () => {
    // 8/10 is exactly 80% — a float ratio 0.8 vs 0.8000000000000002 must not matter.
    expect(determineLevel(8, 10)).toBe('warn80');
    expect(determineLevel(7, 10)).toBe('none');
    expect(determineLevel(799_999, 1_000_000)).toBe('none');
    expect(determineLevel(800_000, 1_000_000)).toBe('warn80');
  });

  test('a non-positive limit never produces a level (no division path)', () => {
    expect(determineLevel(5, 0)).toBe('none');
  });
});

describe('parseTzOffset', () => {
  test('defaults to 0 (UTC) when absent', () => {
    expect(parseTzOffset(undefined)).toBe(0);
    expect(parseTzOffset('')).toBe(0);
  });
  test('accepts integers in -840..840', () => {
    expect(parseTzOffset('540')).toBe(540);
    expect(parseTzOffset('-840')).toBe(-840);
  });
  test('rejects out-of-range and non-integer values', () => {
    expect(parseTzOffset('841')).toBeNull();
    expect(parseTzOffset('1.5')).toBeNull();
    expect(parseTzOffset('abc')).toBeNull();
  });
});

describe('date keys and month window', () => {
  test('localDateKey shifts by the offset', () => {
    const at = new Date('2026-10-31T20:00:00Z');
    expect(localDateKey(at, 0)).toBe('2026-10-31');
    expect(localDateKey(at, 540)).toBe('2026-11-01'); // JST
  });

  test('monthKey follows the local month at the boundary', () => {
    const now = new Date('2026-10-31T16:00:00Z');
    expect(monthKey(now, 0)).toBe('2026-10');
    expect(monthKey(now, 540)).toBe('2026-11');
  });

  test('monthWindow returns the UTC instant of the local month start', () => {
    const w = monthWindow(new Date('2026-11-05T00:00:00Z'), 540);
    expect(w.start.toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(w.daysInMonth).toBe(30);
    expect(w.daysLeftInMonth).toBe(25); // 11/5 JST → 25 days after today
  });

  test('last day of the month has 0 days left; Feb in a non-leap year has 28 days', () => {
    expect(monthWindow(new Date('2026-10-31T10:00:00Z'), 0).daysLeftInMonth).toBe(0);
    expect(monthWindow(new Date('2027-02-10T00:00:00Z'), 0).daysInMonth).toBe(28);
  });
});

describe('resolveExecutionTokens', () => {
  test('prefers tokensUsed when recorded', () => {
    expect(resolveExecutionTokens({ tokensUsed: 500, inputTokens: 10, outputTokens: 20 })).toBe(
      500,
    );
  });
  test('falls back to input + output when tokensUsed is 0', () => {
    expect(resolveExecutionTokens({ tokensUsed: 0, inputTokens: 10, outputTokens: 20 })).toBe(30);
  });
  test('treats null columns as 0', () => {
    expect(resolveExecutionTokens({ tokensUsed: null, inputTokens: null, outputTokens: 7 })).toBe(
      7,
    );
  });
});

describe('sampleUsage (unit switch)', () => {
  test('tokens unit counts tokens, executions unit counts 1 per execution', () => {
    const s = sample('2026-10-10T00:00:00Z', 250);
    expect(sampleUsage(s, 'tokens')).toBe(250);
    expect(sampleUsage(s, 'executions')).toBe(1);
  });
});

describe('computeAvg7', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  test('is 0 when there is no execution in the window', () => {
    expect(computeAvg7([], 'tokens', now, 0)).toBe(0);
    expect(computeAvg7([sample('2026-09-01T00:00:00Z')], 'tokens', now, 0)).toBe(0);
  });

  test('divides by the days since the first active day when history is shorter than 7 days', () => {
    // First activity 3 days ago (10/08) → denominator 3 (10/08, 10/09, 10/10).
    const samples = [sample('2026-10-08T01:00:00Z', 300), sample('2026-10-10T01:00:00Z', 300)];
    expect(computeAvg7(samples, 'tokens', now, 0)).toBe(200);
  });

  test('caps the denominator at 7 and excludes days older than the window', () => {
    const samples = [
      sample('2026-10-01T00:00:00Z', 7000), // 10 days ago — outside
      sample('2026-10-04T00:00:00Z', 700), // first day of the window
      sample('2026-10-10T00:00:00Z', 700),
    ];
    expect(computeAvg7(samples, 'tokens', now, 0)).toBe(200);
  });

  test('counts executions when the unit is executions', () => {
    const samples = [sample('2026-10-10T00:00:00Z'), sample('2026-10-10T02:00:00Z')];
    expect(computeAvg7(samples, 'executions', now, 0)).toBe(2);
  });
});

describe('computeProjection', () => {
  test('returns null forecasts when avg7 is 0', () => {
    const p = computeProjection({ used: 0, limit: 1000, avg7: 0, daysLeftInMonth: 10 });
    expect(p.daysToExhaust).toBeNull();
    expect(p.projectedMonthEnd).toBeNull();
    expect(p.level).toBe('none');
    expect(p.remaining).toBe(1000);
  });

  test('forecasts remaining days and month-end usage from avg7', () => {
    const p = computeProjection({ used: 800, limit: 1000, avg7: 50, daysLeftInMonth: 10 });
    expect(p.level).toBe('warn80');
    expect(p.remaining).toBe(200);
    expect(p.daysToExhaust).toBe(4);
    expect(p.projectedMonthEnd).toBe(1300);
  });

  test('clamps remaining at 0 once exceeded', () => {
    const p = computeProjection({ used: 1200, limit: 1000, avg7: 50, daysLeftInMonth: 3 });
    expect(p.level).toBe('exceeded');
    expect(p.remaining).toBe(0);
    expect(p.daysToExhaust).toBe(0);
  });
});

describe('validateMonthlyLimit', () => {
  test('accepts positive integers only', () => {
    expect(validateMonthlyLimit(1)).toBeNull();
    expect(validateMonthlyLimit(0)).not.toBeNull();
    expect(validateMonthlyLimit(-5)).not.toBeNull();
    expect(validateMonthlyLimit(1.5)).not.toBeNull();
    expect(validateMonthlyLimit('100')).not.toBeNull();
  });
});

describe('validateShares', () => {
  test('accepts shares summing to at most 100', () => {
    expect(
      validateShares([
        { themeId: 1, sharePercent: 60 },
        { themeId: 0, sharePercent: 40 },
      ]),
    ).toBeNull();
    expect(validateShares([{ themeId: 1, sharePercent: 30 }])).toBeNull();
  });
  test('rejects a total above 100', () => {
    expect(
      validateShares([
        { themeId: 1, sharePercent: 60 },
        { themeId: 2, sharePercent: 41 },
      ]),
    ).not.toBeNull();
  });
  test('rejects out-of-range, non-finite and duplicate entries', () => {
    expect(validateShares([{ themeId: 1, sharePercent: -1 }])).not.toBeNull();
    expect(validateShares([{ themeId: 1, sharePercent: Number.NaN }])).not.toBeNull();
    expect(
      validateShares([
        { themeId: 1, sharePercent: 10 },
        { themeId: 1, sharePercent: 10 },
      ]),
    ).not.toBeNull();
    expect(validateShares([{ themeId: -2, sharePercent: 10 }])).not.toBeNull();
  });
});

describe('suggestShares', () => {
  test('returns an empty list when there is no usage', () => {
    expect(suggestShares(new Map())).toEqual([]);
    expect(suggestShares(new Map([[1, 0]]))).toEqual([]);
  });
  test('proportions usage, sorted by share, never summing above 100', () => {
    const s = suggestShares(
      new Map([
        [1, 1],
        [2, 1],
        [3, 1],
      ]),
    );
    expect(s).toHaveLength(3);
    const total = s.reduce((acc, x) => acc + x.sharePercent, 0);
    expect(total).toBeLessThanOrEqual(100);
    expect(s[0].sharePercent).toBe(33.3);
  });
});

describe('shouldPrompt', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  const base: BudgetConfig = {
    unit: 'tokens',
    monthlyLimit: 100,
    snoozedUntil: null,
    acknowledgedKey: null,
    lastNotifiedKey: null,
  };

  test('never prompts at level none', () => {
    expect(shouldPrompt(base, 'none', levelKey('2026-10', 'none'), now)).toBe(false);
  });
  test('prompts at a threshold that was not acknowledged nor snoozed', () => {
    expect(shouldPrompt(base, 'warn80', '2026-10:warn80', now)).toBe(true);
  });
  test('does not prompt again after 続行 at the same level', () => {
    const cfg = { ...base, acknowledgedKey: '2026-10:warn80' };
    expect(shouldPrompt(cfg, 'warn80', '2026-10:warn80', now)).toBe(false);
    expect(shouldPrompt(cfg, 'warn90', '2026-10:warn90', now)).toBe(true);
  });
  test('does not prompt while snoozed, and prompts again once the snooze has passed', () => {
    const snoozed = { ...base, snoozedUntil: new Date('2026-10-10T12:00:00Z') };
    expect(shouldPrompt(snoozed, 'exceeded', '2026-10:exceeded', now)).toBe(false);
    expect(
      shouldPrompt(snoozed, 'exceeded', '2026-10:exceeded', new Date('2026-10-10T13:00:00Z')),
    ).toBe(true);
  });
});
