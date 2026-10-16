import { describe, it, expect } from 'vitest';
import {
  appendDuration,
  isValidDuration,
  toDisplayMinutes,
  trimmedMedianMs,
  DECISION_WINDOW_SIZE,
  MIN_SAMPLES,
} from './decision-duration-stats';

const MIN = 60_000;
const seq = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) * MIN);

describe('isValidDuration', () => {
  it('rejects too short, too long, NaN and negative values', () => {
    expect(isValidDuration(2999)).toBe(false);
    expect(isValidDuration(3000)).toBe(true);
    expect(isValidDuration(1_800_000)).toBe(true);
    expect(isValidDuration(1_800_001)).toBe(false);
    expect(isValidDuration(NaN)).toBe(false);
    expect(isValidDuration(-5)).toBe(false);
  });
});

describe('appendDuration', () => {
  it('leaves the list unchanged for out-of-range values', () => {
    const list = [MIN];
    expect(appendDuration(list, 10)).toEqual(list);
  });
  it('keeps only the latest window, dropping the oldest', () => {
    const list = seq(DECISION_WINDOW_SIZE);
    const next = appendDuration(list, 20 * MIN);
    expect(next).toHaveLength(DECISION_WINDOW_SIZE);
    expect(next[0]).toBe(2 * MIN);
    expect(next[next.length - 1]).toBe(20 * MIN);
  });
});

describe('trimmedMedianMs', () => {
  it('returns null below MIN_SAMPLES and a value at MIN_SAMPLES', () => {
    expect(trimmedMedianMs(seq(MIN_SAMPLES - 1))).toBeNull();
    expect(trimmedMedianMs(seq(MIN_SAMPLES))).toBe(3 * MIN);
  });
  it('does not trim 5-9 samples (even count averages the middle two)', () => {
    expect(trimmedMedianMs([MIN, 2 * MIN, 3 * MIN, 4 * MIN, 5 * MIN, 600 * 1000])).toBe(3.5 * MIN);
  });
  it('trims one value from each end for 10 samples', () => {
    const list = [...seq(9), 29 * MIN]; // outlier on top
    // trimmed: 2..9 => median (5+6)/2 = 5.5 min
    expect(trimmedMedianMs(list)).toBe(5.5 * MIN);
  });
  it('is order independent', () => {
    expect(trimmedMedianMs([5, 1, 4, 2, 3].map((n) => n * MIN))).toBe(3 * MIN);
  });
});

describe('toDisplayMinutes', () => {
  it('rounds and never shows 0', () => {
    expect(toDisplayMinutes(10_000)).toBe(1);
    expect(toDisplayMinutes(4 * MIN + 10_000)).toBe(4);
  });
});
