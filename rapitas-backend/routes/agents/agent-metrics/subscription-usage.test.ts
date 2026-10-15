/**
 * subscription-usage unit tests
 *
 * Verifies the rolling-window partition (ccusage-style blocks), the
 * covered/overage split, current-window remaining budget, and env config
 * resolution.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  computeSubscriptionUsage,
  getSubscriptionConfig,
  type SubscriptionExec,
} from './subscription-usage';

const CFG = { windowHours: 5, windowLimitUsd: 10 };

function exec(iso: string, costUsd: number): SubscriptionExec {
  return { at: new Date(iso), costUsd };
}

beforeEach(() => {
  delete process.env.RAPITAS_SUB_LIMIT_ENABLED;
  delete process.env.RAPITAS_SUB_WINDOW_HOURS;
  delete process.env.RAPITAS_SUB_WINDOW_LIMIT_USD;
});

afterEach(() => {
  delete process.env.RAPITAS_SUB_LIMIT_ENABLED;
  delete process.env.RAPITAS_SUB_WINDOW_HOURS;
  delete process.env.RAPITAS_SUB_WINDOW_LIMIT_USD;
});

describe('computeSubscriptionUsage', () => {
  test('no executions → empty current window with full remaining budget', () => {
    const r = computeSubscriptionUsage([], CFG, new Date('2026-07-06T10:00:00Z'));
    expect(r.currentWindow.startedAt).toBeNull();
    expect(r.currentWindow.usedUsd).toBe(0);
    expect(r.currentWindow.remainingUsd).toBe(10);
    expect(r.period).toEqual({ coveredUsd: 0, overageUsd: 0 });
  });

  test('usage within one active window reports used and remaining', () => {
    const now = new Date('2026-07-06T10:30:00Z');
    const r = computeSubscriptionUsage(
      [exec('2026-07-06T08:10:00Z', 3), exec('2026-07-06T09:00:00Z', 4)],
      CFG,
      now,
    );
    // Window opens at 08:00 (floored) and ends 13:00 — still active at 10:30.
    expect(r.currentWindow.startedAt).toBe('2026-07-06T08:00:00.000Z');
    expect(r.currentWindow.endsAt).toBe('2026-07-06T13:00:00.000Z');
    expect(r.currentWindow.usedUsd).toBe(7);
    expect(r.currentWindow.remainingUsd).toBe(3);
    expect(r.currentWindow.usedRatio).toBe(0.7);
    expect(r.period).toEqual({ coveredUsd: 7, overageUsd: 0 });
  });

  test('usage beyond the window limit is split into overage', () => {
    const now = new Date('2026-07-06T10:00:00Z');
    const r = computeSubscriptionUsage(
      [exec('2026-07-06T08:00:00Z', 8), exec('2026-07-06T09:00:00Z', 7)],
      CFG,
      now,
    );
    expect(r.currentWindow.usedUsd).toBe(15);
    expect(r.currentWindow.remainingUsd).toBe(0);
    expect(r.currentWindow.usedRatio).toBe(1.5);
    expect(r.period).toEqual({ coveredUsd: 10, overageUsd: 5 });
  });

  test('executions past a window boundary open a NEW window', () => {
    const now = new Date('2026-07-06T15:00:00Z');
    const r = computeSubscriptionUsage(
      [
        exec('2026-07-06T02:00:00Z', 12), // window 02:00–07:00 → 10 covered + 2 overage
        exec('2026-07-06T14:00:00Z', 4), // window 14:00–19:00 (active at 15:00)
      ],
      CFG,
      now,
    );
    expect(r.period).toEqual({ coveredUsd: 14, overageUsd: 2 });
    expect(r.currentWindow.startedAt).toBe('2026-07-06T14:00:00.000Z');
    expect(r.currentWindow.usedUsd).toBe(4);
  });

  test('an expired last window leaves no active window', () => {
    const now = new Date('2026-07-06T20:00:00Z');
    const r = computeSubscriptionUsage([exec('2026-07-06T02:00:00Z', 4)], CFG, now);
    expect(r.currentWindow.startedAt).toBeNull();
    expect(r.currentWindow.usedUsd).toBe(0);
    expect(r.currentWindow.remainingUsd).toBe(10);
  });
});

describe('getSubscriptionConfig', () => {
  test('defaults: enabled, 5h window, $35 limit', () => {
    expect(getSubscriptionConfig()).toEqual({
      enabled: true,
      windowHours: 5,
      windowLimitUsd: 35,
    });
  });

  test('env overrides and kill switch', () => {
    process.env.RAPITAS_SUB_LIMIT_ENABLED = '0';
    process.env.RAPITAS_SUB_WINDOW_HOURS = '6';
    process.env.RAPITAS_SUB_WINDOW_LIMIT_USD = '50';
    expect(getSubscriptionConfig()).toEqual({
      enabled: false,
      windowHours: 6,
      windowLimitUsd: 50,
    });
  });
});
