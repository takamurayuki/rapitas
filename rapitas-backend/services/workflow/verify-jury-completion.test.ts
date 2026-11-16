/**
 * verify-jury-completion.test
 *
 * The per-task jury gate lock must stay exclusive even when a waiter's wait
 * limit expires (G2 re-review item 2): a timed-out waiter must NOT run its
 * gate body next to the one still deciding (a FAIL bounce racing a PASS
 * commit), and giving up must not drop the lock registration so that a third
 * caller walks straight in.
 */
import { describe, expect, mock, test } from 'bun:test';

mock.module('../../config', () => ({ prisma: {} }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { withTaskJuryGate, JuryGateBusyError } = await import('./verify-jury-completion');

/** A gate body that holds the lock until released, recording overlap. */
function holder(log: string[], name: string) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return {
    release: () => release(),
    body: async () => {
      log.push(`${name}:start`);
      await gate;
      log.push(`${name}:end`);
      return name;
    },
  };
}

describe('withTaskJuryGate', () => {
  test('runs gates on one task strictly one after another (FIFO)', async () => {
    const log: string[] = [];
    const a = holder(log, 'A');
    const pa = withTaskJuryGate(101, a.body);
    const pb = withTaskJuryGate(101, async () => {
      log.push('B:start');
      return 'B';
    });
    await Bun.sleep(5);
    expect(log).toEqual(['A:start']);
    a.release();
    expect(await pa).toBe('A');
    expect(await pb).toBe('B');
    expect(log).toEqual(['A:start', 'A:end', 'B:start']);
  });

  test('a waiter whose wait limit expires stops instead of running next to the holder', async () => {
    const log: string[] = [];
    const a = holder(log, 'A');
    const pa = withTaskJuryGate(102, a.body);
    const ranB = mock(async () => 'B');
    const pb = withTaskJuryGate(102, ranB, 20);
    await expect(pb).rejects.toBeInstanceOf(JuryGateBusyError);
    // A is still deciding; B never ran its body.
    expect(ranB).not.toHaveBeenCalled();
    expect(log).toEqual(['A:start']);
    a.release();
    await pa;
  });

  test('after a waiter gave up, a third caller still waits for the original holder', async () => {
    const log: string[] = [];
    const a = holder(log, 'A');
    const pa = withTaskJuryGate(103, a.body);
    await expect(withTaskJuryGate(103, async () => 'B', 10)).rejects.toBeInstanceOf(
      JuryGateBusyError,
    );
    const pc = withTaskJuryGate(103, async () => {
      log.push('C:start');
      return 'C';
    });
    await Bun.sleep(20);
    // C must not enter while A holds the gate.
    expect(log).toEqual(['A:start']);
    a.release();
    await pa;
    expect(await pc).toBe('C');
    expect(log).toEqual(['A:start', 'A:end', 'C:start']);
  });

  test('a throwing gate body releases the lock for the next caller', async () => {
    await expect(
      withTaskJuryGate(104, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withTaskJuryGate(104, async () => 'next', 50)).toBe('next');
  });
});
