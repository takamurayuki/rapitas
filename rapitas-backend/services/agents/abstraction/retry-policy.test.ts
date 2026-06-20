/**
 * retry-policy.test
 *
 * Unit tests for env-var loading helpers in retry-policy.ts.
 * Each test restores process.env after mutation to keep cases independent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  parseIntEnv,
  parseFloatEnv,
  getGlobalRetryPolicy,
  getErrorTypeStrategyOverrides,
} from './retry-policy';

describe('parseIntEnv', () => {
  const key = '_TEST_PARSE_INT';

  afterEach(() => {
    delete process.env[key];
  });

  it('returns defaultValue when variable is absent', () => {
    expect(parseIntEnv(key, 5)).toBe(5);
  });

  it('parses a valid integer', () => {
    process.env[key] = '7';
    expect(parseIntEnv(key, 5)).toBe(7);
  });

  it('returns defaultValue for non-numeric input', () => {
    process.env[key] = 'abc';
    expect(parseIntEnv(key, 5)).toBe(5);
  });

  it('clamps negative values to minValue (default 0)', () => {
    process.env[key] = '-3';
    expect(parseIntEnv(key, 5)).toBe(0);
  });

  it('respects custom minValue', () => {
    process.env[key] = '0';
    expect(parseIntEnv(key, 5, 1)).toBe(1);
  });
});

describe('parseFloatEnv', () => {
  const key = '_TEST_PARSE_FLOAT';

  afterEach(() => {
    delete process.env[key];
  });

  it('returns defaultValue when absent', () => {
    expect(parseFloatEnv(key, 2)).toBe(2);
  });

  it('parses a valid float', () => {
    process.env[key] = '1.5';
    expect(parseFloatEnv(key, 2)).toBe(1.5);
  });

  it('returns defaultValue for non-numeric input', () => {
    process.env[key] = 'xyz';
    expect(parseFloatEnv(key, 2)).toBe(2);
  });

  it('clamps values below 1 to 1', () => {
    process.env[key] = '0';
    expect(parseFloatEnv(key, 2)).toBe(1);
  });

  it('clamps negative values to 1', () => {
    process.env[key] = '-2';
    expect(parseFloatEnv(key, 2)).toBe(1);
  });
});

describe('getGlobalRetryPolicy', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved['RAPITAS_RETRY_MAX'] = process.env['RAPITAS_RETRY_MAX'];
    saved['RAPITAS_RETRY_DELAY_MS'] = process.env['RAPITAS_RETRY_DELAY_MS'];
    saved['RAPITAS_RETRY_UPPER_BOUND'] = process.env['RAPITAS_RETRY_UPPER_BOUND'];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns hardcoded defaults when no env vars are set', () => {
    delete process.env['RAPITAS_RETRY_MAX'];
    delete process.env['RAPITAS_RETRY_DELAY_MS'];
    delete process.env['RAPITAS_RETRY_UPPER_BOUND'];
    const policy = getGlobalRetryPolicy();
    expect(policy.maxRetries).toBe(3);
    expect(policy.delayMs).toBe(3000);
    expect(policy.upperBound).toBe(10);
  });

  it('reads RAPITAS_RETRY_MAX', () => {
    process.env['RAPITAS_RETRY_MAX'] = '5';
    expect(getGlobalRetryPolicy().maxRetries).toBe(5);
  });

  it('reads RAPITAS_RETRY_DELAY_MS', () => {
    process.env['RAPITAS_RETRY_DELAY_MS'] = '1000';
    expect(getGlobalRetryPolicy().delayMs).toBe(1000);
  });

  it('reads RAPITAS_RETRY_UPPER_BOUND', () => {
    process.env['RAPITAS_RETRY_UPPER_BOUND'] = '20';
    expect(getGlobalRetryPolicy().upperBound).toBe(20);
  });

  it('clamps negative RAPITAS_RETRY_MAX to 0', () => {
    process.env['RAPITAS_RETRY_MAX'] = '-1';
    expect(getGlobalRetryPolicy().maxRetries).toBe(0);
  });
});

describe('getErrorTypeStrategyOverrides', () => {
  const savedKeys: string[] = [];

  function setEnv(key: string, value: string): void {
    savedKeys.push(key);
    process.env[key] = value;
  }

  afterEach(() => {
    for (const key of savedKeys) delete process.env[key];
    savedKeys.length = 0;
  });

  it('returns empty object when no retry env vars are set', () => {
    expect(Object.keys(getErrorTypeStrategyOverrides())).toHaveLength(0);
  });

  it('builds rate_limit override from RAPITAS_RETRY_RATE_LIMIT_MAX', () => {
    setEnv('RAPITAS_RETRY_RATE_LIMIT_MAX', '10');
    const overrides = getErrorTypeStrategyOverrides();
    expect(overrides.rate_limit?.maxRetries).toBe(10);
  });

  it('builds network override from multiple keys', () => {
    setEnv('RAPITAS_RETRY_NETWORK_MAX', '4');
    setEnv('RAPITAS_RETRY_NETWORK_DELAY_MS', '2000');
    setEnv('RAPITAS_RETRY_NETWORK_MAX_DELAY_MS', '20000');
    setEnv('RAPITAS_RETRY_NETWORK_BACKOFF', '2.5');
    const overrides = getErrorTypeStrategyOverrides();
    expect(overrides.network?.maxRetries).toBe(4);
    expect(overrides.network?.initialDelayMs).toBe(2000);
    expect(overrides.network?.maxDelayMs).toBe(20000);
    expect(overrides.network?.backoffMultiplier).toBe(2.5);
  });

  it('clamps backoff < 1 to 1', () => {
    setEnv('RAPITAS_RETRY_TIMEOUT_BACKOFF', '0');
    const overrides = getErrorTypeStrategyOverrides();
    expect(overrides.timeout?.backoffMultiplier).toBe(1);
  });

  it('omits error types that have no env vars', () => {
    setEnv('RAPITAS_RETRY_RATE_LIMIT_MAX', '8');
    const overrides = getErrorTypeStrategyOverrides();
    expect(overrides.network).toBeUndefined();
    expect(overrides.timeout).toBeUndefined();
  });
});
