/**
 * common.test
 *
 * Unit tests for the shared fault-scenario timeout wrapper and port guard.
 */
import { describe, it, expect, spyOn } from 'bun:test';
import { runWithTimeout, assertIsolatedPort } from '../common';

describe('runWithTimeout', () => {
  it('returns the scenario result when it resolves before the timeout', async () => {
    const result = await runWithTimeout(
      'quick',
      async () => ({ name: 'quick', passed: true, detail: 'ok' }),
      1000,
    );
    expect(result).toEqual({ name: 'quick', passed: true, detail: 'ok' });
  });

  it('returns a timeout failure when the scenario hangs', async () => {
    const result = await runWithTimeout('slow', () => new Promise(() => {}), 50);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('timed out');
  });

  it('catches a thrown error and reports it as a failure', async () => {
    const result = await runWithTimeout(
      'throws',
      async () => {
        throw new Error('kaboom');
      },
      1000,
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('kaboom');
  });
});

describe('assertIsolatedPort', () => {
  it('does not exit for an isolated port', () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('unexpected exit');
    }) as typeof process.exit);
    expect(() => assertIsolatedPort(3211)).not.toThrow();
    exitSpy.mockRestore();
  });

  it('exits for port 3001', () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit:1');
    }) as typeof process.exit);
    expect(() => assertIsolatedPort(3001)).toThrow('exit:1');
    exitSpy.mockRestore();
  });
});
