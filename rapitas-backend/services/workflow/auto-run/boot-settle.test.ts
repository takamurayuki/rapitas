/**
 * boot-settle.test
 *
 * The contract that matters is "boot is never blocked, and the resume still
 * happens", so the scheduler is injected and asserted on rather than waited for.
 */

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_BOOT_SETTLE_MS,
  MAX_BOOT_SETTLE_MS,
  deferAutoRunRecovery,
  resolveBootSettleMs,
} from './boot-settle';

describe('resolveBootSettleMs', () => {
  it('defaults when the variable is unset or blank', () => {
    expect(resolveBootSettleMs({})).toBe(DEFAULT_BOOT_SETTLE_MS);
    expect(resolveBootSettleMs({ RAPITAS_AUTORUN_BOOT_SETTLE_MS: '   ' })).toBe(
      DEFAULT_BOOT_SETTLE_MS,
    );
  });

  it('accepts an explicit value', () => {
    expect(resolveBootSettleMs({ RAPITAS_AUTORUN_BOOT_SETTLE_MS: '15000' })).toBe(15000);
  });

  it('treats 0 as the documented opt-out', () => {
    // CI and headless runs have no UI to protect, and the previous behaviour
    // must stay reachable.
    expect(resolveBootSettleMs({ RAPITAS_AUTORUN_BOOT_SETTLE_MS: '0' })).toBe(0);
  });

  it('clamps an absurd value instead of parking auto-run for hours', () => {
    expect(resolveBootSettleMs({ RAPITAS_AUTORUN_BOOT_SETTLE_MS: '99999999' })).toBe(
      MAX_BOOT_SETTLE_MS,
    );
  });

  it('falls back to the default on a malformed or negative value', () => {
    // NOT 0: a typo must not silently restore the contention this prevents.
    for (const value of ['abc', '-1', 'NaN', '1e']) {
      expect(resolveBootSettleMs({ RAPITAS_AUTORUN_BOOT_SETTLE_MS: value })).toBe(
        DEFAULT_BOOT_SETTLE_MS,
      );
    }
  });

  it('floors a fractional value', () => {
    expect(resolveBootSettleMs({ RAPITAS_AUTORUN_BOOT_SETTLE_MS: '1500.9' })).toBe(1500);
  });
});

describe('deferAutoRunRecovery', () => {
  it('schedules the resume instead of running it, and does not block', () => {
    let ran = false;
    const calls: Array<{ ms: number }> = [];
    const applied = deferAutoRunRecovery(
      async () => {
        ran = true;
      },
      {
        settleMs: 30_000,
        schedule: (fn, ms) => {
          calls.push({ ms });
          // Deliberately NOT invoked: boot must return before the resume runs.
          void fn;
          return 1;
        },
      },
    );

    expect(applied).toBe(30_000);
    expect(calls).toEqual([{ ms: 30_000 }]);
    expect(ran).toBe(false);
  });

  it('runs the scheduled resume when the timer fires', async () => {
    let ran = false;
    let fire: (() => void) | null = null;
    deferAutoRunRecovery(
      async () => {
        ran = true;
      },
      {
        settleMs: 5_000,
        schedule: (fn) => {
          fire = fn;
          return 1;
        },
      },
    );
    expect(ran).toBe(false);
    fire?.();
    await Promise.resolve();
    expect(ran).toBe(true);
  });

  it('resumes immediately when the wait is disabled', () => {
    let ran = false;
    let scheduled = false;
    const applied = deferAutoRunRecovery(
      async () => {
        ran = true;
      },
      {
        settleMs: 0,
        schedule: () => {
          scheduled = true;
          return 1;
        },
      },
    );
    expect(applied).toBe(0);
    expect(ran).toBe(true);
    expect(scheduled).toBe(false);
  });

  it('unrefs the timer so a pending wait cannot hold the process open', () => {
    let unrefed = false;
    deferAutoRunRecovery(async () => {}, {
      settleMs: 1_000,
      schedule: () => ({
        unref: () => {
          unrefed = true;
        },
      }),
    });
    expect(unrefed).toBe(true);
  });

  it('swallows a failing resume rather than throwing from a timer callback', async () => {
    let fire: (() => void) | null = null;
    deferAutoRunRecovery(async () => Promise.reject(new Error('recovery blew up')), {
      settleMs: 1_000,
      schedule: (fn) => {
        fire = fn;
        return 1;
      },
    });
    // An unhandled rejection inside a timer would take the process down.
    expect(() => fire?.()).not.toThrow();
    await Promise.resolve();
  });
});
