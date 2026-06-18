/**
 * spec-quality-checker.test
 *
 * Unit tests for the pure spec-quality heuristics: parsing, scoring, adequacy,
 * and the enrichment merge helper.
 */
import { describe, it, expect } from 'bun:test';
import {
  parseSpecArray,
  mergeSpecField,
  checkSpecQuality,
  ADEQUATE_SCORE,
  MIN_DESCRIPTION_LENGTH,
} from './spec-quality-checker';

const longDescription = 'x'.repeat(MIN_DESCRIPTION_LENGTH);

describe('parseSpecArray', () => {
  it('parses a JSON-array string', () => {
    expect(parseSpecArray('["a","b"]')).toEqual(['a', 'b']);
  });

  it('accepts an actual array', () => {
    expect(parseSpecArray(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('trims and drops empty / whitespace entries', () => {
    expect(parseSpecArray('[" a ","","   "]')).toEqual(['a']);
  });

  it('returns [] for null, undefined, and non-array JSON', () => {
    expect(parseSpecArray(null)).toEqual([]);
    expect(parseSpecArray(undefined)).toEqual([]);
    expect(parseSpecArray('{"a":1}')).toEqual([]);
  });

  it('returns [] for malformed JSON instead of throwing', () => {
    expect(parseSpecArray('[not valid')).toEqual([]);
  });

  it('drops non-string array members', () => {
    expect(parseSpecArray([1, 'a', null, 'b'] as unknown)).toEqual(['a', 'b']);
  });
});

describe('mergeSpecField', () => {
  it('unions existing and derived, de-duplicating and preserving order', () => {
    expect(mergeSpecField('["a"]', ['b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('caps the result length', () => {
    expect(mergeSpecField([], ['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });

  it('ignores empty derived items', () => {
    expect(mergeSpecField(['a'], ['', '  ', 'b'])).toEqual(['a', 'b']);
  });
});

describe('checkSpecQuality', () => {
  const base = { description: null, goals: null, constraints: null, acceptanceCriteria: null };

  it('flags a fully empty spec as inadequate with all fields missing', () => {
    const r = checkSpecQuality(base);
    expect(r.isAdequate).toBe(false);
    expect(r.score).toBe(0);
    expect(r.missing).toEqual(['goals', 'constraints', 'acceptanceCriteria']);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('treats goals + acceptanceCriteria as adequate (reaches ADEQUATE_SCORE)', () => {
    const r = checkSpecQuality({
      ...base,
      goals: ['ship feature'],
      acceptanceCriteria: ['tests pass'],
    });
    expect(r.score).toBeGreaterThanOrEqual(ADEQUATE_SCORE);
    expect(r.isAdequate).toBe(true);
    expect(r.missing).toEqual(['constraints']);
  });

  it('does NOT consider goals + constraints + description adequate without acceptance', () => {
    const r = checkSpecQuality({
      description: longDescription,
      goals: ['g'],
      constraints: ['c'],
      acceptanceCriteria: null,
    });
    // goals(40) + constraints(10) + desc(10) = 60 < 70
    expect(r.score).toBe(60);
    expect(r.isAdequate).toBe(false);
    expect(r.missing).toEqual(['acceptanceCriteria']);
  });

  it('adds a description bonus only past the minimum length', () => {
    const short = checkSpecQuality({ ...base, goals: ['g'], description: 'tiny' });
    const long = checkSpecQuality({ ...base, goals: ['g'], description: longDescription });
    expect(long.score - short.score).toBe(10);
  });

  it('reports a short-description reason', () => {
    const r = checkSpecQuality({ ...base, description: 'short' });
    expect(r.reasons.some((x) => x.includes('説明が短く'))).toBe(true);
  });
});
