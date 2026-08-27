/**
 * pareto-statistics unit tests
 *
 * Verifies the Wilson interval (bounds, degenerate n=0, near-100% behaviour),
 * the normal-approximation mean interval (n=0/1/many), and the sample-size
 * confidence ramp.
 */
import { describe, test, expect } from 'bun:test';
import {
  MIN_RELIABLE_SAMPLES,
  TARGET_SAMPLES,
  meanInterval,
  sampleConfidence,
  wilsonInterval,
} from './pareto-statistics';

describe('wilsonInterval', () => {
  test('returns zeros for an empty sample', () => {
    expect(wilsonInterval(0, 0)).toEqual({ value: 0, ciLow: 0, ciHigh: 0 });
  });

  test('brackets the observed proportion and stays within 0-100', () => {
    const ci = wilsonInterval(9, 10);
    expect(ci.value).toBe(90);
    expect(ci.ciLow).toBeLessThan(90);
    expect(ci.ciHigh).toBeGreaterThan(90);
    expect(ci.ciLow).toBeGreaterThanOrEqual(0);
    expect(ci.ciHigh).toBeLessThanOrEqual(100);
  });

  test('keeps a non-degenerate lower bound at 100% success (Wald would collapse)', () => {
    const ci = wilsonInterval(10, 10);
    expect(ci.value).toBe(100);
    expect(ci.ciHigh).toBe(100);
    expect(ci.ciLow).toBeLessThan(100);
    expect(ci.ciLow).toBeGreaterThan(60);
  });

  test('narrows as the sample grows', () => {
    const small = wilsonInterval(45, 50);
    const large = wilsonInterval(450, 500);
    expect(large.ciHigh - large.ciLow).toBeLessThan(small.ciHigh - small.ciLow);
  });
});

describe('meanInterval', () => {
  test('returns zeros for an empty sample', () => {
    expect(meanInterval([])).toEqual({ value: 0, ciLow: 0, ciHigh: 0 });
  });

  test('collapses to the mean for a single value', () => {
    expect(meanInterval([42])).toEqual({ value: 42, ciLow: 42, ciHigh: 42 });
  });

  test('brackets the mean symmetrically and clamps the lower bound at 0', () => {
    const ci = meanInterval([10, 20, 30, 40]);
    expect(ci.value).toBe(25);
    expect(ci.ciLow).toBeLessThan(25);
    expect(ci.ciHigh).toBeGreaterThan(25);
    expect(ci.ciHigh - 25).toBeCloseTo(25 - ci.ciLow, 5);

    const wide = meanInterval([0, 0, 0, 100]);
    expect(wide.ciLow).toBe(0);
  });

  test('honours the digits argument', () => {
    expect(meanInterval([1.23456, 1.23456], 4).value).toBe(1.2346);
    expect(meanInterval([1234.5, 1234.5], 0).value).toBe(1235);
  });
});

describe('sampleConfidence', () => {
  test('is 0 below the reliability threshold and 1 at the target', () => {
    expect(sampleConfidence(MIN_RELIABLE_SAMPLES - 1)).toBe(0);
    expect(sampleConfidence(MIN_RELIABLE_SAMPLES)).toBe(MIN_RELIABLE_SAMPLES / TARGET_SAMPLES);
    expect(sampleConfidence(TARGET_SAMPLES)).toBe(1);
    expect(sampleConfidence(TARGET_SAMPLES * 3)).toBe(1);
  });
});
