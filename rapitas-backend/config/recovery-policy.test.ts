/**
 * recovery-policy.test
 *
 * Unit tests for environment-profile resolution, env var override validation,
 * fail-safe fallback, the cross-field invariant, and log dedup in
 * recovery-policy.ts. Each test restores process.env / dedup state so cases
 * stay independent.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

const warnMock = mock(() => {});
const infoMock = mock(() => {});

mock.module('./logger', () => ({
  createLogger: () => ({
    warn: warnMock,
    info: infoMock,
    debug: mock(() => {}),
    error: mock(() => {}),
  }),
}));

const { getRecoveryPolicy, __resetRecoveryPolicyLogState } = await import('./recovery-policy');

const RECOVERY_ENV_KEYS = [
  'RAPITAS_RECOVERY_HEARTBEAT_INTERVAL_MS',
  'RAPITAS_RECOVERY_LEASE_STALE_MS',
  'RAPITAS_RECOVERY_LEASE_SWEEP_INTERVAL_MS',
  'RAPITAS_RECOVERY_MAX_AUTO_RESUMES',
  'RAPITAS_RECOVERY_MAX_AGE_MS',
  'RAPITAS_RECOVERY_MAX_PER_PASS',
];

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  __resetRecoveryPolicyLogState();
  warnMock.mockClear();
  infoMock.mockClear();
  for (const key of RECOVERY_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of RECOVERY_ENV_KEYS) delete process.env[key];
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('getRecoveryPolicy — profile defaults', () => {
  it('resolves the production profile (matches pre-existing hardcoded constants)', () => {
    process.env.NODE_ENV = 'production';
    expect(getRecoveryPolicy()).toEqual({
      heartbeatIntervalMs: 15_000,
      leaseStaleMs: 90_000,
      leaseSweepIntervalMs: 60_000,
      maxAutoResumes: 2,
      maxAgeMs: 86_400_000,
      maxPerPass: 3,
    });
  });

  it('resolves the development profile for any non-production NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    expect(getRecoveryPolicy()).toEqual({
      heartbeatIntervalMs: 5_000,
      leaseStaleMs: 20_000,
      leaseSweepIntervalMs: 10_000,
      maxAutoResumes: 2,
      maxAgeMs: 3_600_000,
      maxPerPass: 3,
    });
  });
});

describe('getRecoveryPolicy — env var override', () => {
  it('applies a valid override within range', () => {
    process.env.NODE_ENV = 'development';
    process.env.RAPITAS_RECOVERY_MAX_PER_PASS = '5';
    expect(getRecoveryPolicy().maxPerPass).toBe(5);
  });

  it('falls back to the profile default when the value is above maximum', () => {
    process.env.NODE_ENV = 'development';
    process.env.RAPITAS_RECOVERY_MAX_PER_PASS = '500';
    expect(getRecoveryPolicy().maxPerPass).toBe(3);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the profile default for a non-numeric value', () => {
    process.env.NODE_ENV = 'development';
    process.env.RAPITAS_RECOVERY_MAX_PER_PASS = 'abc';
    expect(getRecoveryPolicy().maxPerPass).toBe(3);
  });
});

describe('getRecoveryPolicy — cross-field invariant', () => {
  it('resets both fields to profile defaults when heartbeat >= leaseStale', () => {
    process.env.NODE_ENV = 'development';
    process.env.RAPITAS_RECOVERY_HEARTBEAT_INTERVAL_MS = '50000';
    process.env.RAPITAS_RECOVERY_LEASE_STALE_MS = '20000';
    const policy = getRecoveryPolicy();
    expect(policy.heartbeatIntervalMs).toBe(5_000);
    expect(policy.leaseStaleMs).toBe(20_000);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});

describe('getRecoveryPolicy — log dedup', () => {
  it('warns at most once per field across repeated calls', () => {
    process.env.NODE_ENV = 'development';
    process.env.RAPITAS_RECOVERY_MAX_PER_PASS = '500';
    getRecoveryPolicy();
    getRecoveryPolicy();
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('logs the resolved-policy snapshot at most once per process', () => {
    process.env.NODE_ENV = 'development';
    getRecoveryPolicy();
    getRecoveryPolicy();
    expect(infoMock).toHaveBeenCalledTimes(1);
  });
});
