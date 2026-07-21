import { describe, test, expect } from 'bun:test';
import { AgentError } from './interfaces';

describe('AgentError', () => {
  test('sets message, type, recoverable, retryAfter, cause, context, and name', () => {
    const cause = new Error('root cause');
    const error = new AgentError('failed', 'network', true, 5000, cause, { taskId: 1 });
    expect(error.message).toBe('failed');
    expect(error.type).toBe('network');
    expect(error.recoverable).toBe(true);
    expect(error.retryAfter).toBe(5000);
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({ taskId: 1 });
    expect(error.name).toBe('AgentError');
    expect(error instanceof Error).toBe(true);
  });

  test('defaults recoverable to false and other optionals to undefined', () => {
    const error = new AgentError('failed', 'internal');
    expect(error.recoverable).toBe(false);
    expect(error.retryAfter).toBeUndefined();
    expect(error.cause).toBeUndefined();
    expect(error.context).toBeUndefined();
  });

  describe('toJSON', () => {
    test('serializes all fields into a plain object', () => {
      const error = new AgentError('failed', 'timeout', true, 100, undefined, { x: 1 });
      const json = error.toJSON();
      expect(json.name).toBe('AgentError');
      expect(json.message).toBe('failed');
      expect(json.type).toBe('timeout');
      expect(json.recoverable).toBe(true);
      expect(json.retryAfter).toBe(100);
      expect(json.context).toEqual({ x: 1 });
      expect(typeof json.stack).toBe('string');
    });

    test('omits context/retryAfter as undefined when not provided', () => {
      const json = new AgentError('failed', 'validation').toJSON();
      expect(json.retryAfter).toBeUndefined();
      expect(json.context).toBeUndefined();
    });
  });
});
