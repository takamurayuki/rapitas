import { describe, test, expect } from 'bun:test';
import { createHash } from 'crypto';
import { createContentHash, cosineSimilarity } from './utils';

describe('createContentHash', () => {
  test('returns the sha256 hex digest of the content', () => {
    const expected = createHash('sha256').update('hello').digest('hex');
    expect(createContentHash('hello')).toBe(expected);
  });

  test('is deterministic for the same input', () => {
    expect(createContentHash('abc')).toBe(createContentHash('abc'));
  });

  test('differs for different input', () => {
    expect(createContentHash('abc')).not.toBe(createContentHash('abd'));
  });

  test('hashes an empty string', () => {
    const expected = createHash('sha256').update('').digest('hex');
    expect(createContentHash('')).toBe(expected);
  });
});

describe('cosineSimilarity', () => {
  test('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  test('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  test('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  test('returns 0 when vector lengths differ', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  test('returns 0 when either vector is all zeros (denominator 0)', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
  });

  test('computes a known non-trivial similarity', () => {
    // a=(1,1), b=(1,0): dot=1, |a|=sqrt(2), |b|=1 -> 1/sqrt(2)
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(1 / Math.sqrt(2), 10);
  });
});
