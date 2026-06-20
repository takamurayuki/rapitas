/**
 * execution-timeouts.test
 *
 * Pins the timeout invariant agent < phase < lock and the env override.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  getPhaseTimeoutMs,
  getWorkflowLockTtlMs,
  getAgentTimeoutMs,
  DEFAULT_PHASE_TIMEOUT_MS,
} from './execution-timeouts';

const KEY = 'RAPITAS_PHASE_TIMEOUT_MS';
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe('execution-timeouts', () => {
  it('defaults the phase timeout when unset', () => {
    delete process.env[KEY];
    expect(getPhaseTimeoutMs()).toBe(DEFAULT_PHASE_TIMEOUT_MS);
  });

  it('honors a valid env override', () => {
    process.env[KEY] = String(20 * 60 * 1000);
    expect(getPhaseTimeoutMs()).toBe(20 * 60 * 1000);
  });

  it('ignores an out-of-range / non-numeric override', () => {
    process.env[KEY] = '500'; // below the 60s floor
    expect(getPhaseTimeoutMs()).toBe(DEFAULT_PHASE_TIMEOUT_MS);
    process.env[KEY] = 'abc';
    expect(getPhaseTimeoutMs()).toBe(DEFAULT_PHASE_TIMEOUT_MS);
  });

  it('keeps the invariant agent < phase < lock for the default', () => {
    delete process.env[KEY];
    expect(getAgentTimeoutMs()).toBeLessThan(getPhaseTimeoutMs());
    expect(getPhaseTimeoutMs()).toBeLessThan(getWorkflowLockTtlMs());
  });

  it('keeps the invariant for a custom phase timeout', () => {
    process.env[KEY] = String(20 * 60 * 1000);
    expect(getAgentTimeoutMs()).toBeLessThan(getPhaseTimeoutMs());
    expect(getPhaseTimeoutMs()).toBeLessThan(getWorkflowLockTtlMs());
  });
});
