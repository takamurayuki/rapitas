import { describe, test, expect } from 'bun:test';
import { assertExpectedUpdatedAt } from './concurrency-guard';
import { ConflictError } from '../../../middleware/error-handler';

describe('assertExpectedUpdatedAt', () => {
  const actual = new Date('2026-10-15T01:00:00.000Z');

  test('passes when expected is omitted (backward compatible)', () => {
    expect(() => assertExpectedUpdatedAt(actual, undefined)).not.toThrow();
  });

  test('passes when expected equals the stored updatedAt', () => {
    expect(() => assertExpectedUpdatedAt(actual, '2026-10-15T01:00:00.000Z')).not.toThrow();
  });

  test('throws ConflictError (409) when expected differs', () => {
    try {
      assertExpectedUpdatedAt(actual, '2026-10-15T00:59:59.000Z');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).statusCode).toBe(409);
    }
  });

  test('throws ConflictError when expected is not a valid date', () => {
    expect(() => assertExpectedUpdatedAt(actual, 'not-a-date')).toThrow(ConflictError);
  });
});
