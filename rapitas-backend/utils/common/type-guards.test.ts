/**
 * type-guards.test
 *
 * Unit tests for the isOneOf / narrowEnum / narrowEnumOrNull utilities.
 */
import { describe, expect, it } from 'bun:test';
import { isOneOf, narrowEnum, narrowEnumOrNull } from './type-guards';

const COLORS = ['red', 'green', 'blue'] as const;
type Color = (typeof COLORS)[number];

describe('isOneOf', () => {
  it('returns true for a valid member', () => {
    expect(isOneOf('red', COLORS)).toBe(true);
    expect(isOneOf('green', COLORS)).toBe(true);
    expect(isOneOf('blue', COLORS)).toBe(true);
  });

  it('returns false for an invalid string', () => {
    expect(isOneOf('yellow', COLORS)).toBe(false);
    expect(isOneOf('', COLORS)).toBe(false);
  });

  it('returns false for non-string types', () => {
    expect(isOneOf(0, COLORS)).toBe(false);
    expect(isOneOf(null, COLORS)).toBe(false);
    expect(isOneOf(undefined, COLORS)).toBe(false);
    expect(isOneOf({}, COLORS)).toBe(false);
    expect(isOneOf(['red'], COLORS)).toBe(false);
  });
});

describe('narrowEnum', () => {
  it('returns the value unchanged when valid', () => {
    const result: Color = narrowEnum<Color>('red', COLORS, 'green');
    expect(result).toBe('red');
  });

  it('returns the fallback for an invalid string', () => {
    expect(narrowEnum('purple', COLORS, 'blue')).toBe('blue');
    expect(narrowEnum('', COLORS, 'red')).toBe('red');
  });

  it('returns the fallback for null', () => {
    expect(narrowEnum(null, COLORS, 'green')).toBe('green');
  });

  it('returns the fallback for undefined', () => {
    expect(narrowEnum(undefined, COLORS, 'green')).toBe('green');
  });

  it('returns the fallback for non-string types', () => {
    expect(narrowEnum(42, COLORS, 'blue')).toBe('blue');
    expect(narrowEnum({}, COLORS, 'blue')).toBe('blue');
  });
});

describe('narrowEnumOrNull', () => {
  it('returns the value unchanged when valid', () => {
    const result: Color | null = narrowEnumOrNull<Color>('blue', COLORS);
    expect(result).toBe('blue');
  });

  it('returns null for an invalid string', () => {
    expect(narrowEnumOrNull('purple', COLORS)).toBeNull();
    expect(narrowEnumOrNull('', COLORS)).toBeNull();
  });

  it('returns null for null', () => {
    expect(narrowEnumOrNull(null, COLORS)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(narrowEnumOrNull(undefined, COLORS)).toBeNull();
  });

  it('returns null for non-string types', () => {
    expect(narrowEnumOrNull(0, COLORS)).toBeNull();
    expect(narrowEnumOrNull({}, COLORS)).toBeNull();
  });
});
