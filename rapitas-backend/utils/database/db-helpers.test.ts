import { describe, test, expect } from 'bun:test';
import { getLabelsArray, toJsonString, fromJsonString, parseId } from './db-helpers';
import { INVALID_ID } from '../common/error-messages';

describe('getLabelsArray', () => {
  test('returns empty array for null/undefined/falsy input', () => {
    expect(getLabelsArray(null)).toEqual([]);
    expect(getLabelsArray(undefined)).toEqual([]);
    expect(getLabelsArray('')).toEqual([]);
  });

  test('parses a JSON string array', () => {
    expect(getLabelsArray('["a","b"]')).toEqual(['a', 'b']);
  });

  test('returns empty array for a malformed JSON string', () => {
    expect(getLabelsArray('not json')).toEqual([]);
  });

  test('returns empty array when the parsed JSON is not an array', () => {
    expect(getLabelsArray('{"a":1}')).toEqual([]);
  });

  test('extracts .name from an object array (Postgres relation)', () => {
    expect(getLabelsArray([{ name: 'bug' }, { name: 'feature' }])).toEqual(['bug', 'feature']);
  });

  test('filters a plain string array', () => {
    expect(getLabelsArray(['a', 'b', 1, null])).toEqual(['a', 'b']);
  });

  test('returns empty array for an empty array', () => {
    expect(getLabelsArray([])).toEqual([]);
  });

  test('returns empty array for an unsupported type (number)', () => {
    expect(getLabelsArray(42)).toEqual([]);
  });
});

describe('toJsonString', () => {
  test('returns null for null/undefined', () => {
    expect(toJsonString(null)).toBeNull();
    expect(toJsonString(undefined)).toBeNull();
  });

  test('returns a string as-is', () => {
    expect(toJsonString('already a string')).toBe('already a string');
  });

  test('stringifies an object', () => {
    expect(toJsonString({ a: 1 })).toBe('{"a":1}');
  });

  test('stringifies an array', () => {
    expect(toJsonString([1, 2, 3])).toBe('[1,2,3]');
  });
});

describe('fromJsonString', () => {
  test('returns null for null/undefined', () => {
    expect(fromJsonString(null)).toBeNull();
    expect(fromJsonString(undefined)).toBeNull();
  });

  test('parses a JSON string', () => {
    expect(fromJsonString<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  test('returns null for a malformed JSON string', () => {
    expect(fromJsonString('not json')).toBeNull();
  });

  test('returns an already-parsed object as-is', () => {
    const obj = { a: 1 };
    expect(fromJsonString(obj)).toBe(obj);
  });
});

describe('parseId', () => {
  test('parses a valid numeric string', () => {
    expect(parseId('42')).toBe(42);
  });

  test('parses a numeric string with trailing non-digits (parseInt behavior)', () => {
    expect(parseId('42abc')).toBe(42);
  });

  test('throws INVALID_ID for a non-numeric string', () => {
    expect(() => parseId('abc')).toThrow(INVALID_ID);
  });

  test('throws INVALID_ID for an empty string', () => {
    expect(() => parseId('')).toThrow(INVALID_ID);
  });
});
