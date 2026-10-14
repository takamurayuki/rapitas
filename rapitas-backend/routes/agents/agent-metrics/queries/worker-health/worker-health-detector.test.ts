/**
 * worker-health-detector unit tests
 *
 * Covers the consecutive-run rule and the lag-24 autocorrelation collapse rule.
 */
import { describe, test, expect } from 'bun:test';
import { detectRun, autocorrelation, detectPeriodicityCollapse } from './worker-health-detector';

const H = 24 * 7;
const periodic = (n: number) =>
  Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / 24));
const noise = (n: number) => Array.from({ length: n }, (_, i) => ((i * 7919) % 13) / 13);

describe('detectRun', () => {
  test('fires on exactly N consecutive points at the threshold', () => {
    expect(detectRun([0, 1.5, 1.5, 1.5], 1.5, 3)).toEqual({ fired: true, endIndex: 3 });
  });
  test('does not fire on N-1 points', () => {
    expect(detectRun([0, 1.5, 1.5, 0], 1.5, 3).fired).toBe(false);
  });
  test('a null (pending) point breaks the run', () => {
    expect(detectRun([2, 2, null, 2], 1.5, 3).fired).toBe(false);
  });
  test('reports a run that is still open at the end of the series', () => {
    const r = detectRun([2, 2, 2, 2, 2], 1.5, 3);
    expect(r.fired).toBe(true);
    expect(r.endIndex).toBe(4);
  });
});

describe('autocorrelation', () => {
  test('is high for a periodic series', () => {
    expect(autocorrelation(periodic(96), 24) as number).toBeGreaterThan(0.7);
  });
  test('returns null when the series is too short', () => {
    expect(autocorrelation([1, 2, 3], 24)).toBeNull();
  });
});

describe('detectPeriodicityCollapse', () => {
  test('does not fire on a series that stays periodic', () => {
    expect(detectPeriodicityCollapse(periodic(2 * H)).fired).toBe(false);
  });
  test('fires when the recent week loses its daily rhythm', () => {
    expect(detectPeriodicityCollapse([...periodic(H), ...noise(H)]).fired).toBe(true);
  });
  test('does not fire when the series is shorter than two weeks', () => {
    expect(detectPeriodicityCollapse(noise(H)).fired).toBe(false);
  });
  test('null points do not throw', () => {
    const s: Array<number | null> = [...periodic(H), ...noise(H)];
    s[H + 5] = null;
    expect(() => detectPeriodicityCollapse(s)).not.toThrow();
  });
});
