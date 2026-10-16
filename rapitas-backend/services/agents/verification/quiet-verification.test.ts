/**
 * quiet-verification.test
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces the logger.
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const {
  lowerVerificationPriority,
  runProjectChecks,
  areVerificationChecksSequential,
  VERIFY_CHILD_PRIORITY,
} = await import('./quiet-verification');

beforeEach(() => {
  delete process.env.RAPITAS_VERIFY_QUIET;
  delete process.env.RAPITAS_VERIFY_PARALLEL;
});
afterAll(() => {
  delete process.env.RAPITAS_VERIFY_QUIET;
  delete process.env.RAPITAS_VERIFY_PARALLEL;
});

describe('lowerVerificationPriority', () => {
  test('pid があれば BELOW_NORMAL を適用する', () => {
    const calls: Array<[number, number]> = [];
    const ok = lowerVerificationPriority(4242, (pid, prio) => {
      calls.push([pid, prio]);
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([[4242, VERIFY_CHILD_PRIORITY]]);
  });

  test('pid が無い（spawn がモック/失敗）なら何もしない', () => {
    const calls: number[] = [];
    expect(lowerVerificationPriority(undefined, (pid) => calls.push(pid))).toBe(false);
    expect(calls).toEqual([]);
  });

  test('OS が拒否しても例外にしない', () => {
    expect(
      lowerVerificationPriority(1, () => {
        throw new Error('EPERM');
      }),
    ).toBe(false);
  });

  test('RAPITAS_VERIFY_QUIET=off で無効化', () => {
    process.env.RAPITAS_VERIFY_QUIET = 'off';
    const calls: number[] = [];
    expect(lowerVerificationPriority(1, (pid) => calls.push(pid))).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('runProjectChecks', () => {
  /** Records the order checks start and finish so overlap is observable. */
  function tracked() {
    const events: string[] = [];
    const step =
      <T>(name: string, value: T) =>
      () =>
        new Promise<T>((resolve) => {
          events.push(`${name}:start`);
          setTimeout(() => {
            events.push(`${name}:end`);
            resolve(value);
          }, 5);
        });
    return { events, step };
  }

  test('既定は直列: lint+format → type → test の順で、tsc とテストは重ならない', async () => {
    expect(areVerificationChecksSequential()).toBe(true);
    const { events, step } = tracked();
    const r = await runProjectChecks({
      lint: step('lint', 'L'),
      type: step('type', 'T'),
      test: step('test', 'S'),
      format: step('format', 'F'),
    });
    expect(r).toEqual(['L', 'T', 'S', 'F']);
    expect(events.indexOf('type:start')).toBeGreaterThan(events.indexOf('lint:end'));
    expect(events.indexOf('type:start')).toBeGreaterThan(events.indexOf('format:end'));
    expect(events.indexOf('test:start')).toBeGreaterThan(events.indexOf('type:end'));
  });

  test('RAPITAS_VERIFY_PARALLEL=1 で従来の同時実行に戻る', async () => {
    process.env.RAPITAS_VERIFY_PARALLEL = '1';
    expect(areVerificationChecksSequential()).toBe(false);
    const { events, step } = tracked();
    await runProjectChecks({
      lint: step('lint', 1),
      type: step('type', 2),
      test: step('test', 3),
      format: step('format', 4),
    });
    expect(events.slice(0, 4)).toEqual(['lint:start', 'type:start', 'test:start', 'format:start']);
  });
});
