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
  resolveAgentWallClockTimeoutMs,
  DEFAULT_PHASE_TIMEOUT_MS,
} from './execution-timeouts';

const KEY = 'RAPITAS_PHASE_TIMEOUT_MS';
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

// Default agent cap derived from the phase default (30min - 2min margin).
const BASE_AGENT_MS = DEFAULT_PHASE_TIMEOUT_MS - 2 * 60 * 1000;

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

describe('resolveAgentWallClockTimeoutMs (role-aware, task 546)', () => {
  it('keeps the current default for role-less and non-implementer roles', () => {
    delete process.env[KEY];
    expect(resolveAgentWallClockTimeoutMs(undefined, {})).toBe(BASE_AGENT_MS);
    expect(resolveAgentWallClockTimeoutMs('researcher', {})).toBe(BASE_AGENT_MS);
    expect(resolveAgentWallClockTimeoutMs('planner', {})).toBe(BASE_AGENT_MS);
    expect(resolveAgentWallClockTimeoutMs('verifier', {})).toBe(BASE_AGENT_MS);
  });

  it('doubles the default for the implementer role (56 min)', () => {
    delete process.env[KEY];
    expect(resolveAgentWallClockTimeoutMs('implementer', {})).toBe(BASE_AGENT_MS * 2);
    expect(getAgentTimeoutMs('implementer')).toBe(3360000);
  });

  it('applies the shared override to every role', () => {
    delete process.env[KEY];
    const env = { RAPITAS_AGENT_WALLCLOCK_MS: String(10 * 60 * 1000) };
    expect(resolveAgentWallClockTimeoutMs(undefined, env)).toBe(10 * 60 * 1000);
    expect(resolveAgentWallClockTimeoutMs('implementer', env)).toBe(10 * 60 * 1000);
    expect(resolveAgentWallClockTimeoutMs('researcher', env)).toBe(10 * 60 * 1000);
  });

  it('prefers the per-role override over the shared one', () => {
    delete process.env[KEY];
    const env = {
      RAPITAS_AGENT_WALLCLOCK_MS: String(10 * 60 * 1000),
      RAPITAS_AGENT_WALLCLOCK_IMPLEMENTER_MS: String(45 * 60 * 1000),
    };
    expect(resolveAgentWallClockTimeoutMs('implementer', env)).toBe(45 * 60 * 1000);
    // Other roles are untouched by the implementer-specific key.
    expect(resolveAgentWallClockTimeoutMs('verifier', env)).toBe(10 * 60 * 1000);
  });

  it('falls back past invalid values (non-numeric / below the 60s floor)', () => {
    delete process.env[KEY];
    const env = {
      RAPITAS_AGENT_WALLCLOCK_IMPLEMENTER_MS: 'abc',
      RAPITAS_AGENT_WALLCLOCK_MS: '500',
    };
    // Both overrides invalid → role default (implementer = base x2).
    expect(resolveAgentWallClockTimeoutMs('implementer', env)).toBe(BASE_AGENT_MS * 2);
    // Invalid per-role key falls back to a valid shared one.
    const env2 = {
      RAPITAS_AGENT_WALLCLOCK_IMPLEMENTER_MS: '500',
      RAPITAS_AGENT_WALLCLOCK_MS: String(15 * 60 * 1000),
    };
    expect(resolveAgentWallClockTimeoutMs('implementer', env2)).toBe(15 * 60 * 1000);
  });

  it('keeps the phase backstop above the implementer agent cap', () => {
    delete process.env[KEY];
    expect(getPhaseTimeoutMs('implementer')).toBeGreaterThan(getAgentTimeoutMs('implementer'));
    expect(getPhaseTimeoutMs('implementer')).toBe(3480000);
    // Non-implementer roles keep the unchanged phase default.
    expect(getPhaseTimeoutMs('researcher')).toBe(DEFAULT_PHASE_TIMEOUT_MS);
  });
});
