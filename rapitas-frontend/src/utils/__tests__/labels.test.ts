import { describe, it, expect } from 'vitest';
import { getLabelsArray, hasLabels } from '../labels';

describe('getLabelsArray', () => {
  it('returns empty array for null/undefined', () => {
    expect(getLabelsArray(null)).toEqual([]);
    expect(getLabelsArray(undefined)).toEqual([]);
    expect(getLabelsArray('')).toEqual([]);
  });

  it('parses JSON string array (SQLite format)', () => {
    expect(getLabelsArray('["bug","feature"]')).toEqual(['bug', 'feature']);
  });

  it('returns empty array for invalid JSON string', () => {
    expect(getLabelsArray('not-json')).toEqual([]);
  });

  it('returns empty array for JSON non-array string', () => {
    expect(getLabelsArray('"just a string"')).toEqual([]);
    expect(getLabelsArray('42')).toEqual([]);
  });

  it('handles native array (PostgreSQL format)', () => {
    expect(getLabelsArray(['bug', 'feature'])).toEqual(['bug', 'feature']);
  });

  it('filters non-string items from array', () => {
    expect(getLabelsArray(['valid', 42, null, 'also-valid'])).toEqual(['valid', 'also-valid']);
  });

  it('returns empty array for non-string/non-array input', () => {
    expect(getLabelsArray(42)).toEqual([]);
    expect(getLabelsArray({})).toEqual([]);
    expect(getLabelsArray(true)).toEqual([]);
  });
});

describe('hasLabels', () => {
  it('returns true when labels exist', () => {
    expect(hasLabels(['bug'])).toBe(true);
    expect(hasLabels('["bug"]')).toBe(true);
  });

  it('returns false when no labels', () => {
    expect(hasLabels(null)).toBe(false);
    expect(hasLabels([])).toBe(false);
    expect(hasLabels('[]')).toBe(false);
  });
});
