/**
 * type-guards.test
 *
 * Unit tests for makeStringTypeGuard factory.
 * Covers: is/narrow, all edge cases, destructure-safety.
 */
import { describe, it, expect } from 'bun:test';
import { makeStringTypeGuard } from './type-guards';

const COLORS = ['red', 'green', 'blue'] as const;
type Color = (typeof COLORS)[number];

const { is: isColor, narrow: narrowColor } = makeStringTypeGuard(COLORS);

describe('makeStringTypeGuard', () => {
  describe('is (type predicate)', () => {
    it('returns true for all valid values', () => {
      expect(isColor('red')).toBe(true);
      expect(isColor('green')).toBe(true);
      expect(isColor('blue')).toBe(true);
    });

    it('returns false for an invalid string', () => {
      expect(isColor('yellow')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isColor('')).toBe(false);
    });

    it('returns false for null', () => {
      expect(isColor(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isColor(undefined)).toBe(false);
    });

    it('returns false for a number', () => {
      expect(isColor(42)).toBe(false);
    });

    it('returns false for an object', () => {
      expect(isColor({ value: 'red' })).toBe(false);
    });

    it('returns false for an array containing a valid value', () => {
      expect(isColor(['red'])).toBe(false);
    });
  });

  describe('narrow (safe coercion)', () => {
    it('returns the value when it is valid', () => {
      const result: Color = narrowColor('green', 'red');
      expect(result).toBe('green');
    });

    it('returns the fallback for an invalid string', () => {
      expect(narrowColor('purple', 'red')).toBe('red');
    });

    it('returns the fallback for null', () => {
      expect(narrowColor(null, 'blue')).toBe('blue');
    });

    it('returns the fallback for undefined', () => {
      expect(narrowColor(undefined, 'green')).toBe('green');
    });

    it('returns the fallback for empty string', () => {
      expect(narrowColor('', 'red')).toBe('red');
    });

    it('uses a custom fallback correctly', () => {
      expect(narrowColor('bad', 'blue')).toBe('blue');
    });

    it('handles a single-element value set', () => {
      const { narrow: narrowSingle } = makeStringTypeGuard(['only'] as const);
      expect(narrowSingle('only', 'only')).toBe('only');
      expect(narrowSingle('other', 'only')).toBe('only');
    });
  });

  describe('destructure safety', () => {
    it('narrow works correctly after destructuring (no this-context loss)', () => {
      // This is the critical test: `this` must NOT be used inside narrow.
      const { narrow } = makeStringTypeGuard(COLORS);
      expect(narrow('red', 'blue')).toBe('red');
      expect(narrow('bad', 'blue')).toBe('blue');
    });

    it('is works correctly after destructuring', () => {
      const { is } = makeStringTypeGuard(COLORS);
      expect(is('green')).toBe(true);
      expect(is('x')).toBe(false);
    });
  });
});
