/**
 * pid-alive.test
 *
 * The liveness check must not launch a process (it replaced tasklist) and must
 * tell a live process, a missing one and a protected one apart.
 */
import { describe, expect, test } from 'bun:test';
import { isPidAlive } from './pid-alive';

describe('isPidAlive', () => {
  test('the current process is alive', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test('an unused id is not alive', () => {
    expect(isPidAlive(999_999_7)).toBe(false);
  });

  test('invalid ids are not alive', () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
  });

  test('a process we may not signal still counts as alive (EPERM)', () => {
    const original = process.kill;
    process.kill = (() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    }) as typeof process.kill;
    try {
      expect(isPidAlive(1234)).toBe(true);
    } finally {
      process.kill = original;
    }
  });
});
