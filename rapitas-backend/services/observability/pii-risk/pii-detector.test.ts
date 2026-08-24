/**
 * pii-detector.test.ts
 *
 * Unit tests for structural PII detection: the four positive patterns,
 * non-match guarantees for PII-lookalike strings (UUID / ISO8601 / port),
 * and empty-input handling.
 */
import { describe, it, expect } from 'bun:test';
import { detectPii } from './pii-detector';

describe('detectPii — positive patterns', () => {
  it.each([
    ['email', 'user test@example.com failed', 'email'],
    ['Japanese phone', 'tel: 03-1234-5678', 'phone_jp'],
    ['international phone', 'call +81-90-1234-5678 now', 'phone_intl'],
    ['credit-card-shaped number', 'card 4111-1111-1111-1111 declined', 'credit_card'],
  ] as const)('detects %s', (_label, input, expectedType) => {
    expect(detectPii(input).map((h) => h.type)).toContain(expectedType);
  });

  it('counts multiple occurrences of the same type', () => {
    const hits = detectPii('a@example.com and b@example.org');
    expect(hits).toEqual([{ type: 'email', count: 2 }]);
  });
});

describe('detectPii — non-match guarantees (false-positive prevention)', () => {
  it.each([
    ['a UUID', 'id=550e8400-e29b-41d4-a716-446655440000'],
    ['an ISO8601 timestamp', 'at 2026-08-24T10:15:30.123Z'],
    ['a bare port number', 'listening on 3001'],
    ['undelimited long digit runs', 'epoch 1756000000000 request 4111111111111111'],
  ] as const)('does not match %s', (_label, input) => {
    expect(detectPii(input)).toEqual([]);
  });
});

describe('detectPii — boundary values', () => {
  it('returns an empty array for an empty string', () => {
    expect(detectPii('')).toEqual([]);
  });

  it('handles a large input without error', () => {
    const big = 'x'.repeat(100_000) + ' contact@example.com';
    expect(detectPii(big)).toEqual([{ type: 'email', count: 1 }]);
  });
});
