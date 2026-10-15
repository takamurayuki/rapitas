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
  const cases: Array<{ label: string; value: unknown; expected: boolean }> = [
    { label: 'a valid member "red"', value: 'red', expected: true },
    { label: 'a valid member "green"', value: 'green', expected: true },
    { label: 'a valid member "blue"', value: 'blue', expected: true },
    { label: 'an invalid string "yellow"', value: 'yellow', expected: false },
    { label: 'an invalid empty string', value: '', expected: false },
    { label: 'a number', value: 0, expected: false },
    { label: 'null', value: null, expected: false },
    { label: 'undefined', value: undefined, expected: false },
    { label: 'a plain object', value: {}, expected: false },
    { label: 'an array', value: ['red'], expected: false },
  ];

  it.each(cases)('returns $expected for $label', ({ value, expected }) => {
    expect(isOneOf(value, COLORS)).toBe(expected);
  });
});

describe('narrowEnum', () => {
  const cases: Array<{ label: string; value: unknown; fallback: Color; expected: Color }> = [
    { label: 'the value unchanged when valid', value: 'red', fallback: 'green', expected: 'red' },
    {
      label: 'the fallback for an invalid string "purple"',
      value: 'purple',
      fallback: 'blue',
      expected: 'blue',
    },
    {
      label: 'the fallback for an invalid empty string',
      value: '',
      fallback: 'red',
      expected: 'red',
    },
    { label: 'the fallback for null', value: null, fallback: 'green', expected: 'green' },
    {
      label: 'the fallback for undefined',
      value: undefined,
      fallback: 'green',
      expected: 'green',
    },
    { label: 'the fallback for a number', value: 42, fallback: 'blue', expected: 'blue' },
    { label: 'the fallback for a plain object', value: {}, fallback: 'blue', expected: 'blue' },
  ];

  it.each(cases)('returns $label', ({ value, fallback, expected }) => {
    expect(narrowEnum(value, COLORS, fallback)).toBe(expected);
  });
});

describe('narrowEnumOrNull', () => {
  const cases: Array<{ label: string; value: unknown; expected: Color | null }> = [
    { label: 'the value unchanged when valid', value: 'blue', expected: 'blue' },
    { label: 'null for an invalid string "purple"', value: 'purple', expected: null },
    { label: 'null for an invalid empty string', value: '', expected: null },
    { label: 'null for null', value: null, expected: null },
    { label: 'null for undefined', value: undefined, expected: null },
    { label: 'null for a number', value: 0, expected: null },
    { label: 'null for a plain object', value: {}, expected: null },
  ];

  it.each(cases)('returns $label', ({ value, expected }) => {
    expect(narrowEnumOrNull(value, COLORS)).toBe(expected);
  });
});
