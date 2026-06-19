/**
 * shuffle-test.test.ts
 *
 * Unit tests for the pure functions exported by scripts/shuffle-test.ts.
 * Covers: PRNG seeding, Fisher-Yates shuffle, path filtering, and seed parsing.
 */

import { describe, test, expect } from 'bun:test';
import {
  createLcgPrng,
  shuffleArray,
  filterExcluded,
  parseSeed,
  INTEGRATION_EXCLUDE_PATTERN,
} from '../shuffle-test';

describe('createLcgPrng', () => {
  test('produces identical sequence for the same seed', () => {
    const prng1 = createLcgPrng(42);
    const prng2 = createLcgPrng(42);
    for (let i = 0; i < 100; i++) {
      expect(prng1()).toBe(prng2());
    }
  });

  test('produces different sequences for different seeds', () => {
    const seq1 = Array.from({ length: 20 }, createLcgPrng(1));
    const seq2 = Array.from({ length: 20 }, createLcgPrng(2));
    expect(seq1).not.toEqual(seq2);
  });

  test('always returns values in [0, 1)', () => {
    const prng = createLcgPrng(9999);
    for (let i = 0; i < 1000; i++) {
      const v = prng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('handles seed 0', () => {
    const prng = createLcgPrng(0);
    const v = prng();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe('shuffleArray', () => {
  test('produces identical order for the same seed (reproducibility)', () => {
    const arr = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result1 = shuffleArray(arr, createLcgPrng(42));
    const result2 = shuffleArray(arr, createLcgPrng(42));
    expect(result1).toEqual(result2);
  });

  test('preserves all elements (no additions or drops)', () => {
    const arr = ['a', 'b', 'c', 'd', 'e'];
    const result = shuffleArray(arr, createLcgPrng(7));
    expect(result).toHaveLength(arr.length);
    expect([...result].sort()).toEqual([...arr].sort());
  });

  test('does not mutate the original array', () => {
    const arr = ['x', 'y', 'z'];
    const snapshot = [...arr];
    shuffleArray(arr, createLcgPrng(1));
    expect(arr).toEqual(snapshot);
  });

  test('handles empty array without errors', () => {
    expect(shuffleArray([], createLcgPrng(1))).toEqual([]);
  });

  test('handles single-element array', () => {
    expect(shuffleArray(['only'], createLcgPrng(1))).toEqual(['only']);
  });

  test('produces different order for different seeds (statistical)', () => {
    // With 20 elements the chance of identical order under different seeds is negligible.
    const arr = Array.from({ length: 20 }, (_, i) => i.toString());
    const r1 = shuffleArray(arr, createLcgPrng(100));
    const r2 = shuffleArray(arr, createLcgPrng(200));
    expect(r1).not.toEqual(r2);
  });
});

describe('filterExcluded', () => {
  test('removes POSIX integration paths', () => {
    const files = [
      '/app/tests/unit/foo.test.ts',
      '/app/tests/integration/db.test.ts',
      '/app/services/bar.test.ts',
    ];
    const result = filterExcluded(files, INTEGRATION_EXCLUDE_PATTERN);
    expect(result).toEqual(['/app/tests/unit/foo.test.ts', '/app/services/bar.test.ts']);
  });

  test('removes Windows-style integration paths', () => {
    const files = ['C:\\app\\tests\\unit\\foo.test.ts', 'C:\\app\\tests\\integration\\db.test.ts'];
    const result = filterExcluded(files, INTEGRATION_EXCLUDE_PATTERN);
    expect(result).toEqual(['C:\\app\\tests\\unit\\foo.test.ts']);
  });

  test('returns all files when none match the pattern', () => {
    const files = ['/unit/a.test.ts', '/services/b.test.ts'];
    expect(filterExcluded(files, INTEGRATION_EXCLUDE_PATTERN)).toEqual(files);
  });

  test('returns empty array for empty input', () => {
    expect(filterExcluded([], INTEGRATION_EXCLUDE_PATTERN)).toEqual([]);
  });

  test('accepts custom exclusion pattern', () => {
    const files = ['alpha.test.ts', 'beta.test.ts', 'gamma.test.ts'];
    const result = filterExcluded(files, /beta/);
    expect(result).toEqual(['alpha.test.ts', 'gamma.test.ts']);
  });
});

describe('parseSeed', () => {
  test('returns a finite number for undefined (default seed)', () => {
    const seed = parseSeed(undefined);
    expect(Number.isFinite(seed)).toBe(true);
  });

  test('returns the default seed for an empty string', () => {
    expect(parseSeed('')).toBe(parseSeed(undefined));
  });

  test('parses a valid integer string', () => {
    expect(parseSeed('12345')).toBe(12345);
  });

  test('parses the string "0" as 0', () => {
    expect(parseSeed('0')).toBe(0);
  });

  test('falls back to default for a non-numeric string', () => {
    expect(parseSeed('not-a-number')).toBe(parseSeed(undefined));
  });

  test('falls back to default for "NaN"', () => {
    expect(parseSeed('NaN')).toBe(parseSeed(undefined));
  });

  test('falls back to default for "Infinity"', () => {
    expect(parseSeed('Infinity')).toBe(parseSeed(undefined));
  });
});
