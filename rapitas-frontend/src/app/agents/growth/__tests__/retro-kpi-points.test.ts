/**
 * retro-kpi-points.test
 *
 * Verifies window-to-point shaping (oldest first, M/D labels, null
 * passthrough), this-week vs last-week diff extraction for 0/1/2+ windows,
 * and tone resolution per improvement direction.
 */
import { describe, it, expect } from 'vitest';
import {
  computeKpiDiff,
  formatWeekLabel,
  resolveKpiDiffTone,
  toRetroKpiPoints,
} from '../components/retro-kpi-points';
import type { RetroKpiWindow } from '../types';

function makeWindow(over: Partial<RetroKpiWindow> & { to: string }): RetroKpiWindow {
  return {
    from: '2026-01-01T00:00:00.000Z',
    repairRate: { completedTasks: 0, repairedTasks: 0, rate: null },
    autoMerged: 0,
    autoMergeExhausted: 0,
    autoMergeConflictFiled: 0,
    verifyNoChangeConfirmed: 0,
    verifyRepairNonConvergence: 0,
    leadTimeMinutes: { sampleSize: 0, medianMinutes: null },
    ...over,
  };
}

// Noon UTC keeps the local-time M/D label stable across UTC±11 runners.
const THIS_WEEK = makeWindow({
  to: '2026-08-30T12:00:00.000Z',
  repairRate: { completedTasks: 10, repairedTasks: 3, rate: 0.3 },
  autoMerged: 92,
});
const LAST_WEEK = makeWindow({
  to: '2026-08-23T12:00:00.000Z',
  repairRate: { completedTasks: 8, repairedTasks: 4, rate: 0.5 },
  autoMerged: 80,
});

describe('formatWeekLabel', () => {
  it('formats as M/D without zero padding', () => {
    expect(formatWeekLabel('2026-03-05T12:00:00.000Z')).toBe('3/5');
  });
});

describe('toRetroKpiPoints', () => {
  it('reverses to oldest-first and keeps null values as null', () => {
    const points = toRetroKpiPoints(
      [THIS_WEEK, LAST_WEEK, makeWindow({ to: '2026-08-16T12:00:00.000Z' })],
      (w) => ({
        rate: w.repairRate.rate,
      }),
    );
    expect(points).toEqual([
      { weekLabel: '8/16', rate: null },
      { weekLabel: '8/23', rate: 0.5 },
      { weekLabel: '8/30', rate: 0.3 },
    ]);
  });
});

describe('computeKpiDiff', () => {
  it('returns both values null for an empty ledger', () => {
    expect(computeKpiDiff([], (w) => w.autoMerged, 'higher_is_better')).toEqual({
      currentValue: null,
      previousValue: null,
      direction: 'higher_is_better',
    });
  });

  it('returns previousValue null when only one window exists', () => {
    expect(computeKpiDiff([THIS_WEEK], (w) => w.autoMerged, 'higher_is_better')).toEqual({
      currentValue: 92,
      previousValue: null,
      direction: 'higher_is_better',
    });
  });

  it('uses windows[0] as this week and windows[1] as last week', () => {
    const diff = computeKpiDiff(
      [THIS_WEEK, LAST_WEEK],
      (w) => w.repairRate.rate,
      'lower_is_better',
    );
    expect(diff).toEqual({ currentValue: 0.3, previousValue: 0.5, direction: 'lower_is_better' });
  });

  it('propagates a null picked value instead of coercing to zero', () => {
    const diff = computeKpiDiff(
      [THIS_WEEK, LAST_WEEK],
      (w) => w.leadTimeMinutes.medianMinutes,
      'lower_is_better',
    );
    expect(diff.currentValue).toBeNull();
    expect(diff.previousValue).toBeNull();
  });
});

describe('resolveKpiDiffTone', () => {
  it.each([
    ['higher_is_better', 5, 3, 'improved'],
    ['higher_is_better', 3, 5, 'worsened'],
    ['lower_is_better', 3, 5, 'improved'],
    ['lower_is_better', 5, 3, 'worsened'],
    ['neutral', 5, 3, 'neutral'],
    ['neutral', 3, 5, 'neutral'],
    ['lower_is_better', 4, 4, 'neutral'],
  ] as const)('%s: %d vs %d → %s', (direction, current, previous, expected) => {
    expect(resolveKpiDiffTone({ currentValue: current, previousValue: previous, direction })).toBe(
      expected,
    );
  });

  it('is neutral when either side is null', () => {
    expect(
      resolveKpiDiffTone({ currentValue: null, previousValue: 1, direction: 'lower_is_better' }),
    ).toBe('neutral');
    expect(
      resolveKpiDiffTone({ currentValue: 1, previousValue: null, direction: 'lower_is_better' }),
    ).toBe('neutral');
  });
});
