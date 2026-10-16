/**
 * error-capture.test.ts
 *
 * Integration-level unit tests for the pii-risk pipeline inside
 * error-capture: ring-buffer mitigation via recordError /
 * recordFrontendError, the RAPITAS_PII_RISK_MITIGATION=off kill switch,
 * and sentryBeforeSend event mitigation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type * as Sentry from '@sentry/bun';
import {
  recordError,
  recordFrontendError,
  getRecentErrors,
  clearRecentErrors,
  sentryBeforeSend,
} from './error-capture';

// NOTE: Assembled at runtime — a contiguous secret-shaped literal in source
// trips the gitleaks CI gate even though it is a test dummy.
const FAKE_SK_KEY = 'sk-' + 'abcdefghijklmnopqrstuvwxyz123456';

// Two emails → piiScore 40 → at least medium, so masking must kick in.
const TWO_EMAILS = 'mail from alice@example.com to bob@example.org failed';

beforeEach(() => {
  clearRecentErrors();
  delete process.env.RAPITAS_PII_RISK_MITIGATION;
});

afterEach(() => {
  delete process.env.RAPITAS_PII_RISK_MITIGATION;
});

describe('recordError — ring buffer mitigation', () => {
  it('masks PII in the message and records the risk level', () => {
    recordError(new Error(TWO_EMAILS));
    const [entry] = getRecentErrors();
    expect(entry.message).not.toContain('alice@example.com');
    expect(entry.message).not.toContain('bob@example.org');
    expect(entry.message).toContain('[REDACTED:EMAIL]');
    expect(['medium', 'high', 'critical']).toContain(entry.riskLevel);
    expect(entry.riskScore).toBeGreaterThanOrEqual(40);
  });

  it('leaves a short PII-free message unchanged at low risk', () => {
    recordError(new Error('Database connection refused'));
    const [entry] = getRecentErrors();
    expect(entry.message).toBe('Database connection refused');
    expect(entry.riskLevel).toBe('low');
  });

  it('masks secret-shaped values even at low risk', () => {
    recordError(new Error(`init failed key=${FAKE_SK_KEY}`));
    const [entry] = getRecentErrors();
    expect(entry.message).not.toContain(FAKE_SK_KEY);
    expect(entry.message).toContain('[REDACTED]');
    expect(entry.riskLevel).toBe('low');
  });

  it('masks PII inside the context object', () => {
    recordError(new Error(TWO_EMAILS), { prompt: 'reply to carol@example.net' });
    const [entry] = getRecentErrors();
    expect(JSON.stringify(entry.context)).not.toContain('carol@example.net');
  });

  it('survives a circular context without crashing', () => {
    const ctx: Record<string, unknown> = { note: TWO_EMAILS };
    ctx.self = ctx;
    expect(() => recordError(new Error(TWO_EMAILS), ctx)).not.toThrow();
    const [entry] = getRecentErrors();
    expect(entry).toBeDefined();
  });
});

describe('recordFrontendError — mitigation applies to the frontend path', () => {
  it('masks PII in a frontend-reported message', () => {
    recordFrontendError({ message: TWO_EMAILS, url: 'http://localhost:3000/tasks' });
    const [entry] = getRecentErrors();
    expect(entry.source).toBe('frontend');
    expect(entry.message).not.toContain('alice@example.com');
    expect(entry.message).toContain('[REDACTED:EMAIL]');
  });
});

describe('RAPITAS_PII_RISK_MITIGATION=off — kill switch', () => {
  it('passes raw data through and records no risk fields', () => {
    process.env.RAPITAS_PII_RISK_MITIGATION = 'off';
    recordError(new Error(TWO_EMAILS));
    const [entry] = getRecentErrors();
    expect(entry.message).toBe(TWO_EMAILS);
    expect(entry.riskScore).toBeUndefined();
    expect(entry.riskLevel).toBeUndefined();
  });

  it('passes secrets through untouched as well', () => {
    process.env.RAPITAS_PII_RISK_MITIGATION = 'off';
    recordError(new Error(`key=${FAKE_SK_KEY}`));
    const [entry] = getRecentErrors();
    expect(entry.message).toContain(FAKE_SK_KEY);
  });
});

describe('sentryBeforeSend — Sentry event mitigation', () => {
  const makeEvent = (value: string, extra?: Record<string, unknown>): Sentry.ErrorEvent =>
    ({
      type: undefined,
      exception: { values: [{ type: 'Error', value }] },
      extra,
      request: { headers: { cookie: 'session=abc', authorization: 'Bearer x', accept: '*/*' } },
    }) as unknown as Sentry.ErrorEvent;

  it('always strips credential headers', () => {
    const out = sentryBeforeSend(makeEvent('boom'));
    expect(out.request?.headers?.['cookie']).toBeUndefined();
    expect(out.request?.headers?.['authorization']).toBeUndefined();
    expect(out.request?.headers?.['accept']).toBe('*/*');
  });

  it('masks PII in the exception value and extra', () => {
    const out = sentryBeforeSend(makeEvent(TWO_EMAILS, { input: 'dave@example.com' }));
    const value = out.exception?.values?.[0]?.value ?? '';
    expect(value).not.toContain('alice@example.com');
    expect(value).toContain('[REDACTED:EMAIL]');
    expect(JSON.stringify(out.extra)).not.toContain('dave@example.com');
  });

  it('returns an event without exception values untouched and without throwing', () => {
    const bare = { type: undefined } as unknown as Sentry.ErrorEvent;
    expect(() => sentryBeforeSend(bare)).not.toThrow();
    expect(sentryBeforeSend(bare)).toBe(bare);
  });

  it('only strips headers when the kill switch is set', () => {
    process.env.RAPITAS_PII_RISK_MITIGATION = 'off';
    const out = sentryBeforeSend(makeEvent(TWO_EMAILS));
    expect(out.exception?.values?.[0]?.value).toBe(TWO_EMAILS);
    expect(out.request?.headers?.['cookie']).toBeUndefined();
  });
});
