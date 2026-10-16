/**
 * decision.test
 *
 * Gate-by-gate coverage of decideAutoRestart (pure function, no mocks needed).
 */
import { describe, test, expect } from 'bun:test';
import { decideAutoRestart, type AutoRestartDecisionInput } from './decision';

/** All-gates-pass baseline; each test flips exactly one gate. */
function baseInput(): AutoRestartDecisionInput {
  return {
    aheadCount: 3,
    activeExecutions: 0,
    runningExecutions: 0,
    queueDepth: 0,
    isShuttingDown: false,
    settingEnabled: true,
    msSinceLastRestart: null,
    minRestartIntervalMs: 30 * 60 * 1000,
  };
}

describe('decideAutoRestart', () => {
  test('all gates pass → shouldRestart with reason ok', () => {
    expect(decideAutoRestart(baseInput())).toEqual({ shouldRestart: true, reason: 'ok' });
  });

  test('toggle off blocks first regardless of other gates', () => {
    const result = decideAutoRestart({ ...baseInput(), settingEnabled: false, aheadCount: 0 });
    expect(result).toEqual({ shouldRestart: false, reason: 'setting-disabled' });
  });

  test('aheadCount 0 → no-unactivated-commits', () => {
    const result = decideAutoRestart({ ...baseInput(), aheadCount: 0 });
    expect(result).toEqual({ shouldRestart: false, reason: 'no-unactivated-commits' });
  });

  test('negative aheadCount → no-unactivated-commits', () => {
    const result = decideAutoRestart({ ...baseInput(), aheadCount: -1 });
    expect(result.shouldRestart).toBe(false);
    expect(result.reason).toBe('no-unactivated-commits');
  });

  test('isShuttingDown → already-shutting-down (dual-restart-path guard)', () => {
    const result = decideAutoRestart({ ...baseInput(), isShuttingDown: true });
    expect(result).toEqual({ shouldRestart: false, reason: 'already-shutting-down' });
  });

  test('activeExecutions > 0 → active-executions', () => {
    const result = decideAutoRestart({ ...baseInput(), activeExecutions: 1 });
    expect(result).toEqual({ shouldRestart: false, reason: 'active-executions' });
  });

  test('runningExecutions > 0 → running-executions', () => {
    const result = decideAutoRestart({ ...baseInput(), runningExecutions: 2 });
    expect(result).toEqual({ shouldRestart: false, reason: 'running-executions' });
  });

  test('queueDepth > 0 → queue-not-empty', () => {
    const result = decideAutoRestart({ ...baseInput(), queueDepth: 5 });
    expect(result).toEqual({ shouldRestart: false, reason: 'queue-not-empty' });
  });

  test('within the rate-limit window → rate-limited', () => {
    const result = decideAutoRestart({
      ...baseInput(),
      msSinceLastRestart: 10 * 60 * 1000,
      minRestartIntervalMs: 30 * 60 * 1000,
    });
    expect(result).toEqual({ shouldRestart: false, reason: 'rate-limited' });
  });

  test('past the rate-limit window → shouldRestart', () => {
    const result = decideAutoRestart({
      ...baseInput(),
      msSinceLastRestart: 31 * 60 * 1000,
      minRestartIntervalMs: 30 * 60 * 1000,
    });
    expect(result).toEqual({ shouldRestart: true, reason: 'ok' });
  });

  test('msSinceLastRestart null (never restarted) is not rate-limited', () => {
    const result = decideAutoRestart({ ...baseInput(), msSinceLastRestart: null });
    expect(result.shouldRestart).toBe(true);
  });

  test('exactly at the rate-limit boundary is allowed (>= passes)', () => {
    const result = decideAutoRestart({
      ...baseInput(),
      msSinceLastRestart: 30 * 60 * 1000,
      minRestartIntervalMs: 30 * 60 * 1000,
    });
    expect(result.shouldRestart).toBe(true);
  });
});
