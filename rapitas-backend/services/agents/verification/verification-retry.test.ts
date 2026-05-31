/**
 * verification-retry.test
 *
 * Unit tests for the pure retry helpers: reading/writing the retry counter in
 * session.metadata JSON, and building the implementer feedback instruction.
 * The DB-driven retryOrBlock flow is an integration concern covered elsewhere.
 */
import { describe, it, expect } from 'bun:test';
import {
  parseRetryCount,
  withRetryCount,
  buildFixInstruction,
} from './verification-retry';
import type { VerificationResult } from './automated-verifier';

describe('parseRetryCount', () => {
  it('returns 0 for null/empty/invalid metadata', () => {
    expect(parseRetryCount(null)).toBe(0);
    expect(parseRetryCount('')).toBe(0);
    expect(parseRetryCount('not json')).toBe(0);
    expect(parseRetryCount('{}')).toBe(0);
  });

  it('reads the stored count', () => {
    expect(parseRetryCount('{"verificationRetries":2}')).toBe(2);
  });

  it('ignores a non-numeric stored value', () => {
    expect(parseRetryCount('{"verificationRetries":"x"}')).toBe(0);
  });
});

describe('withRetryCount', () => {
  it('sets the count while preserving other keys', () => {
    const out = withRetryCount('{"foo":1}', 3);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.foo).toBe(1);
    expect(parsed.verificationRetries).toBe(3);
  });

  it('round-trips with parseRetryCount', () => {
    expect(parseRetryCount(withRetryCount(null, 5))).toBe(5);
  });
});

describe('buildFixInstruction', () => {
  it('embeds the verification evidence and the attempt number', () => {
    const result: VerificationResult = {
      ok: false,
      changedFiles: ['a.ts'],
      checks: [{ name: 'lint', ran: true, ok: false, errorCount: 1, details: 'eslint: x' }],
      summary: '自動検証: lint=NG(1) / typecheck=ok',
    };
    const text = buildFixInstruction(result, 2);
    expect(text).toContain('自己修復 2 回目');
    expect(text).toContain('自動検証結果');
    expect(text).toContain('eslint: x');
  });
});
