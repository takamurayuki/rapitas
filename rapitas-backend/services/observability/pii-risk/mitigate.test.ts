/**
 * mitigate.test.ts
 *
 * Unit tests for staged mitigation: per-level behavior of mitigateText and
 * mitigateContext, truncation boundary, critical filtering, and
 * circular-reference guarding.
 */
import { describe, it, expect } from 'bun:test';
import {
  mitigateText,
  mitigateContext,
  PII_TRUNCATE_MAX_CHARS,
  TRUNCATED_SUFFIX,
} from './mitigate';

const PII_TEXT = 'user test@example.com called 03-1234-5678';

describe('mitigateText', () => {
  it('returns the input unchanged at low', () => {
    expect(mitigateText(PII_TEXT, 'low')).toBe(PII_TEXT);
  });

  it('masks PII only at medium, keeping surrounding text intact', () => {
    const out = mitigateText(PII_TEXT, 'medium');
    expect(out).not.toContain('test@example.com');
    expect(out).not.toContain('03-1234-5678');
    expect(out).toContain('[REDACTED:EMAIL]');
    expect(out).toContain('[REDACTED:PHONE_JP]');
    expect(out.startsWith('user ')).toBe(true);
    expect(out).toContain(' called ');
  });

  it('does not truncate at medium even when the text is long', () => {
    const long = 'a'.repeat(PII_TRUNCATE_MAX_CHARS + 100);
    expect(mitigateText(long, 'medium')).toBe(long);
  });

  it('truncates text above the cap at high', () => {
    const long = 'a'.repeat(PII_TRUNCATE_MAX_CHARS + 1);
    const out = mitigateText(long, 'high');
    expect(out.length).toBe(PII_TRUNCATE_MAX_CHARS + TRUNCATED_SUFFIX.length);
    expect(out.endsWith(TRUNCATED_SUFFIX)).toBe(true);
  });

  it('keeps text at exactly the cap untouched at high', () => {
    const exact = 'a'.repeat(PII_TRUNCATE_MAX_CHARS);
    expect(mitigateText(exact, 'high')).toBe(exact);
  });

  it('masks and truncates at critical', () => {
    const long = PII_TEXT + ' ' + 'b'.repeat(PII_TRUNCATE_MAX_CHARS * 2);
    const out = mitigateText(long, 'critical');
    expect(out).not.toContain('test@example.com');
    expect(out.endsWith(TRUNCATED_SUFFIX)).toBe(true);
  });
});

describe('mitigateContext', () => {
  it('returns undefined for undefined input at any level', () => {
    expect(mitigateContext(undefined, 'low')).toBeUndefined();
    expect(mitigateContext(undefined, 'critical')).toBeUndefined();
  });

  it('returns the original object untouched at low', () => {
    const ctx = { email: 'a@example.com' };
    expect(mitigateContext(ctx, 'low')).toBe(ctx);
  });

  it('masks nested string leaves at medium', () => {
    const ctx = {
      prompt: 'reach me at a@example.com',
      nested: { items: ['tel 03-1234-5678', 42] },
    };
    const out = mitigateContext(ctx, 'medium') as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain('a@example.com');
    expect(JSON.stringify(out)).not.toContain('03-1234-5678');
    const nested = out.nested as { items: unknown[] };
    expect(nested.items[1]).toBe(42);
  });

  it('drops values wholesale at critical, keeping only key names', () => {
    const ctx = { prompt: 'secret pii a@example.com', userAgent: 'x' };
    const out = mitigateContext(ctx, 'critical') as Record<string, unknown>;
    expect(out).toEqual({
      __filtered: true,
      reason: 'risk_score_critical',
      originalKeys: ['prompt', 'userAgent'],
    });
    expect(JSON.stringify(out)).not.toContain('a@example.com');
  });

  it('replaces circular references with [Circular] instead of recursing forever', () => {
    const ctx: Record<string, unknown> = { name: 'a@example.com' };
    ctx.self = ctx;
    const out = mitigateContext(ctx, 'medium') as Record<string, unknown>;
    expect(out.self).toBe('[Circular]');
    expect(out.name).toBe('[REDACTED:EMAIL]');
  });
});
