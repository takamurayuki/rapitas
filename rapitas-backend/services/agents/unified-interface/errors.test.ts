/**
 * unified-interface/errors ユニットテスト
 *
 * AgentError クラス（コード・詳細・recoverable フラグ・JSON シリアライズ）と
 * isAgentError / isRecoverableError の型ガードを検証する。
 * NOTE: services/agents/abstraction/interfaces.ts にも同名の別 AgentError
 * クラスが存在するが、コンストラクタ引数が異なる無関係な実装であるため
 * このテストとは独立している。
 */
import { describe, test, expect } from 'bun:test';
import { AgentError, AgentErrorCode, isAgentError, isRecoverableError } from './errors';

describe('AgentError', () => {
  test('sets name, code, message, details, and recoverable', () => {
    const err = new AgentError(AgentErrorCode.EXECUTION_TIMEOUT, 'timed out', { taskId: 42 }, true);
    expect(err.name).toBe('AgentError');
    expect(err.code).toBe('E2001');
    expect(err.message).toBe('timed out');
    expect(err.details).toEqual({ taskId: 42 });
    expect(err.recoverable).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  test('defaults recoverable to false and details to undefined', () => {
    const err = new AgentError(AgentErrorCode.PROVIDER_UNAVAILABLE, 'provider down');
    expect(err.recoverable).toBe(false);
    expect(err.details).toBeUndefined();
  });

  test('toJSON returns a plain serializable object', () => {
    const err = new AgentError(AgentErrorCode.SESSION_EXPIRED, 'session gone', { sessionId: 1 });
    expect(err.toJSON()).toEqual({
      name: 'AgentError',
      code: 'E3001',
      message: 'session gone',
      details: { sessionId: 1 },
      recoverable: false,
    });
  });

  test('toJSON output survives JSON.stringify/parse round-trip', () => {
    const err = new AgentError(AgentErrorCode.QUESTION_TIMEOUT, 'no answer', undefined, true);
    const roundTripped = JSON.parse(JSON.stringify(err.toJSON()));
    expect(roundTripped).toEqual({
      name: 'AgentError',
      code: 'E4001',
      message: 'no answer',
      details: undefined,
      recoverable: true,
    });
  });
});

describe('isAgentError', () => {
  test('returns true for an AgentError instance', () => {
    expect(isAgentError(new AgentError(AgentErrorCode.CONFIG_INVALID, 'bad config'))).toBe(true);
  });

  test('returns false for a plain Error', () => {
    expect(isAgentError(new Error('plain'))).toBe(false);
  });

  test('returns false for non-error values', () => {
    expect(isAgentError('a string')).toBe(false);
    expect(isAgentError(null)).toBe(false);
    expect(isAgentError(undefined)).toBe(false);
    expect(isAgentError({ code: 'E1001' })).toBe(false);
  });
});

describe('isRecoverableError', () => {
  test('returns true when the AgentError is marked recoverable', () => {
    const err = new AgentError(
      AgentErrorCode.EXECUTION_RATE_LIMITED,
      'rate limited',
      undefined,
      true,
    );
    expect(isRecoverableError(err)).toBe(true);
  });

  test('returns false when the AgentError is not recoverable', () => {
    const err = new AgentError(AgentErrorCode.EXECUTION_FAILED, 'failed');
    expect(isRecoverableError(err)).toBe(false);
  });

  test('returns false for a non-AgentError value', () => {
    expect(isRecoverableError(new Error('plain'))).toBe(false);
    expect(isRecoverableError('oops')).toBe(false);
  });
});
