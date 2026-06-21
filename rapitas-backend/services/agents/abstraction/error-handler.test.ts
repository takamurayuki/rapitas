/**
 * error-handler.test
 *
 * Unit tests for DefaultErrorHandler env-var overrides and the
 * getDefaultErrorHandler / resetDefaultErrorHandler singleton lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  DefaultErrorHandler,
  getDefaultErrorHandler,
  resetDefaultErrorHandler,
} from './error-handler';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const retryEnvKeys: string[] = [
  'RAPITAS_RETRY_RATE_LIMIT_MAX',
  'RAPITAS_RETRY_RATE_LIMIT_DELAY_MS',
  'RAPITAS_RETRY_RATE_LIMIT_MAX_DELAY_MS',
  'RAPITAS_RETRY_RATE_LIMIT_BACKOFF',
  'RAPITAS_RETRY_TIMEOUT_MAX',
  'RAPITAS_RETRY_NETWORK_MAX',
];

const savedEnv: Record<string, string | undefined> = {};

function saveEnv(): void {
  for (const k of retryEnvKeys) savedEnv[k] = process.env[k];
}

function restoreEnv(): void {
  for (const k of retryEnvKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// DefaultErrorHandler — retryStrategies constructor option
// ──────────────────────────────────────────────────────────────────────────────

describe('DefaultErrorHandler — retryStrategies merge', () => {
  it('applies rate_limit override from constructor', () => {
    const handler = new DefaultErrorHandler({
      retryStrategies: { rate_limit: { maxRetries: 10 } },
    });
    const strategy = handler.getRetryStrategy('rate_limit', 9);
    expect(strategy.shouldRetry).toBe(true);
    expect(strategy.maxRetries).toBe(10);
  });

  it('does not retry rate_limit at maxRetries (10)', () => {
    const handler = new DefaultErrorHandler({
      retryStrategies: { rate_limit: { maxRetries: 10 } },
    });
    const strategy = handler.getRetryStrategy('rate_limit', 10);
    expect(strategy.shouldRetry).toBe(false);
  });

  it('preserves default rate_limit maxRetries (5) when not overridden', () => {
    const handler = new DefaultErrorHandler();
    const strategy = handler.getRetryStrategy('rate_limit', 4);
    expect(strategy.shouldRetry).toBe(true);
    const atDefault = handler.getRetryStrategy('rate_limit', 5);
    expect(atDefault.shouldRetry).toBe(false);
  });

  it('merges delay overrides without touching unspecified fields', () => {
    const handler = new DefaultErrorHandler({
      retryStrategies: { network: { initialDelayMs: 100 } },
    });
    // backoffMultiplier should stay at default (2 for network)
    const strategy = handler.getRetryStrategy('network', 0);
    // delay = 100 * 2^0 = 100
    expect(strategy.delay).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getDefaultErrorHandler + resetDefaultErrorHandler
// ──────────────────────────────────────────────────────────────────────────────

describe('getDefaultErrorHandler / resetDefaultErrorHandler', () => {
  beforeEach(() => {
    saveEnv();
    resetDefaultErrorHandler();
  });

  afterEach(() => {
    restoreEnv();
    resetDefaultErrorHandler();
  });

  it('returns the same instance on consecutive calls', () => {
    const a = getDefaultErrorHandler();
    const b = getDefaultErrorHandler();
    expect(a).toBe(b);
  });

  it('creates a new instance after reset', () => {
    const first = getDefaultErrorHandler();
    resetDefaultErrorHandler();
    const second = getDefaultErrorHandler();
    expect(first).not.toBe(second);
  });

  it('reads RAPITAS_RETRY_RATE_LIMIT_MAX on initialisation', () => {
    process.env['RAPITAS_RETRY_RATE_LIMIT_MAX'] = '10';
    const handler = getDefaultErrorHandler();
    // retryCount=9 should still retry
    expect(handler.getRetryStrategy('rate_limit', 9).shouldRetry).toBe(true);
    // retryCount=10 should not
    expect(handler.getRetryStrategy('rate_limit', 10).shouldRetry).toBe(false);
  });

  it('reverts to default (5) after reset when env var is cleared', () => {
    process.env['RAPITAS_RETRY_RATE_LIMIT_MAX'] = '10';
    getDefaultErrorHandler(); // initialise with override
    resetDefaultErrorHandler();
    delete process.env['RAPITAS_RETRY_RATE_LIMIT_MAX'];
    const handler = getDefaultErrorHandler();
    expect(handler.getRetryStrategy('rate_limit', 5).shouldRetry).toBe(false);
    expect(handler.getRetryStrategy('rate_limit', 4).shouldRetry).toBe(true);
  });

  it('env var affects delay when RAPITAS_RETRY_RATE_LIMIT_DELAY_MS is set', () => {
    process.env['RAPITAS_RETRY_RATE_LIMIT_DELAY_MS'] = '1000';
    const handler = getDefaultErrorHandler();
    // retryCount=0: delay = initialDelayMs * backoff^0 = 1000
    const strategy = handler.getRetryStrategy('rate_limit', 0);
    expect(strategy.delay).toBe(1000);
  });
});
