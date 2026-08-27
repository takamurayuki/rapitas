/**
 * pareto.utils.test
 *
 * Verifies query-string construction, unit conversion, signed/interval
 * formatting and the error-bar half-width derivation used by the chart.
 */
import { describe, it, expect } from 'vitest';
import {
  buildParetoQuery,
  errorBarRange,
  formatInterval,
  formatSigned,
  formatUsd,
  toSeconds,
} from '../pareto.utils';

describe('buildParetoQuery', () => {
  it('serialises the filters and optionally the goal', () => {
    const filters = { days: 30, complexityBand: 'high' as const, role: 'implementer' };
    expect(buildParetoQuery(filters)).toBe('days=30&complexityBand=high&role=implementer');
    expect(buildParetoQuery(filters, { kind: 'successRate', value: 95 })).toBe(
      'days=30&complexityBand=high&role=implementer&goal=successRate&value=95',
    );
  });
});

describe('formatting helpers', () => {
  it('converts ms to seconds with one decimal', () => {
    expect(toSeconds(61_250)).toBe(61.3);
    expect(toSeconds(0)).toBe(0);
  });

  it('formats USD with four decimals', () => {
    expect(formatUsd(0.1234567)).toBe('$0.1235');
  });

  it('formats signed deltas with an explicit plus sign', () => {
    expect(formatSigned(12.34, 1, '%')).toBe('+12.3%');
    expect(formatSigned(-3, 2, 'h')).toBe('-3.00h');
    expect(formatSigned(0)).toBe('0.0');
  });

  it('renders value [low – high] with a custom formatter', () => {
    const estimate = { value: 90, ciLow: 80.5, ciHigh: 96.2 };
    expect(formatInterval(estimate)).toBe('90.0 [80.5 – 96.2]');
    expect(formatInterval(estimate, (v) => String(Math.round(v)))).toBe('90 [81 – 96]');
  });
});

describe('errorBarRange', () => {
  it('returns non-negative half-widths below and above the estimate', () => {
    expect(errorBarRange({ value: 90, ciLow: 80, ciHigh: 96 })).toEqual([10, 6]);
    expect(errorBarRange({ value: 100, ciLow: 100, ciHigh: 100 })).toEqual([0, 0]);
  });

  it('applies the unit scale to every bound', () => {
    expect(errorBarRange({ value: 60_000, ciLow: 50_000, ciHigh: 65_000 }, toSeconds)).toEqual([
      10, 5,
    ]);
  });
});
