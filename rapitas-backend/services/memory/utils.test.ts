import { describe, test, expect } from 'bun:test';
import { createHash } from 'crypto';
import { createContentHash, cosineSimilarity, parseTagsAsStrings } from './utils';

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

describe('parseTagsAsStrings', () => {
  test('parses a well-formed string array', () => {
    expect(parseTagsAsStrings('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });

  test('returns [] for the hypothesis ledger overloaded {evidence:[...]} shape', () => {
    // Regression: hypothesis-service.ts stores tags as JSON.stringify({evidence:[...]})
    // instead of a string[] (a deliberate storage hack, see its file header) — a bare
    // JSON.parse would return that raw object, which later crashed the frontend when
    // spliced into a merged tags array by consolidation.ts's flatMap.
    expect(parseTagsAsStrings('{"evidence":[{"stance":"for","detail":"x"}]}')).toEqual([]);
  });

  test('filters out non-string elements from an otherwise-valid array', () => {
    expect(parseTagsAsStrings('["ok",{"evidence":[]},42,null,"also-ok"]')).toEqual([
      'ok',
      'also-ok',
    ]);
  });

  test('returns [] for invalid JSON', () => {
    expect(parseTagsAsStrings('not json')).toEqual([]);
  });

  test('returns [] for an empty array', () => {
    expect(parseTagsAsStrings('[]')).toEqual([]);
  });
});
