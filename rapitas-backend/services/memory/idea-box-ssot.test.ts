/**
 * idea-box-ssot.test
 *
 * Tests for the IDEA_PRIORITIES SSOT array, normalizeIdeaPriority, and the
 * generated isIdeaPriority guard. Kept separate from idea-box-novelty.test.ts
 * to avoid bun mock.module process-global collisions.
 */
import { describe, test, expect } from 'bun:test';
import { IDEA_PRIORITIES, normalizeIdeaPriority } from './idea-box-service';
import { isIdeaPriority } from './idea-box-service.guards.generated';

describe('IDEA_PRIORITIES (SSOT array)', () => {
  test('contains all expected priority strings', () => {
    expect(IDEA_PRIORITIES).toEqual(['urgent', 'high', 'medium', 'low']);
  });
});

describe('normalizeIdeaPriority', () => {
  test.each(['urgent', 'high', 'medium', 'low'] as const)(
    'passes through valid priority "%s"',
    (p) => {
      expect(normalizeIdeaPriority(p)).toBe(p);
    },
  );

  test('defaults unknown string to "medium"', () => {
    expect(normalizeIdeaPriority('critical')).toBe('medium');
  });

  test('defaults undefined to "medium"', () => {
    expect(normalizeIdeaPriority(undefined)).toBe('medium');
  });

  test('defaults null to "medium"', () => {
    expect(normalizeIdeaPriority(null)).toBe('medium');
  });
});

describe('isIdeaPriority (generated guard)', () => {
  test.each(['urgent', 'high', 'medium', 'low'] as const)(
    'returns true for valid priority "%s"',
    (p) => {
      expect(isIdeaPriority(p)).toBe(true);
    },
  );

  test('returns false for invalid string', () => {
    expect(isIdeaPriority('critical')).toBe(false);
  });

  test('returns false for null / undefined', () => {
    expect(isIdeaPriority(null)).toBe(false);
    expect(isIdeaPriority(undefined)).toBe(false);
  });
});
