/**
 * Error Capture テスト
 *
 * Verifies the in-memory ring buffer behavior. Sentry forwarding is intentionally
 * not exercised — it activates only when SENTRY_DSN is set, and the SDK is a
 * pure pass-through dependency.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  recordError,
  recordFrontendError,
  getRecentErrors,
  clearRecentErrors,
} from '../../services/system/error-capture';

describe('error-capture ring buffer', () => {
  beforeEach(() => {
    clearRecentErrors();
  });

  it('明示的に記録したエラーが取得できる', () => {
    recordError(new Error('boom'));
    const recent = getRecentErrors();
    expect(recent.length).toBe(1);
    expect(recent[0].message).toBe('boom');
    expect(recent[0].source).toBe('explicit');
  });

  it('frontendエラーは frontend ソースで記録される', () => {
    recordFrontendError({ message: 'fe-boom', stack: 'at foo' });
    const recent = getRecentErrors();
    expect(recent[0].source).toBe('frontend');
    expect(recent[0].stack).toBe('at foo');
  });

  it('新しい順で返される', () => {
    recordError(new Error('first'));
    recordError(new Error('second'));
    recordError(new Error('third'));
    const recent = getRecentErrors();
    expect(recent.map((e) => e.message)).toEqual(['third', 'second', 'first']);
  });

  it('clearRecentErrorsで空になる', () => {
    recordError(new Error('a'));
    recordError(new Error('b'));
    clearRecentErrors();
    expect(getRecentErrors().length).toBe(0);
  });

  it('Errorでない値もErrorに変換して記録する', () => {
    recordError('string-error');
    const recent = getRecentErrors();
    expect(recent[0].message).toBe('string-error');
  });
});
