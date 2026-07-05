/**
 * role-evidence unit tests
 *
 * Verifies proven-tier resolution from recorded outcomes: sample/success
 * thresholds, cheapest-tier-wins ordering, the RAPITAS_EVIDENCE_ROUTING kill
 * switch, null-model exclusion, and the per-role TTL cache.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const findMany = mock(() => Promise.resolve([] as unknown[]));
mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: { findMany },
  },
}));

import { getRoleModelOutcomes, resolveProvenTier, _resetProvenTierCache } from './role-evidence';

/** Build n outcome rows for a model, `fails` of which are failures. */
function rows(modelName: string, n: number, fails = 0): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    status: i < fails ? 'failed' : 'completed',
    errorMessage: null,
    modelName,
  }));
}

beforeEach(() => {
  _resetProvenTierCache();
  findMany.mockReset();
  findMany.mockImplementation(() => Promise.resolve([]));
  delete process.env.RAPITAS_EVIDENCE_ROUTING;
  delete process.env.RAPITAS_EVIDENCE_MIN_SAMPLES;
  delete process.env.RAPITAS_EVIDENCE_MIN_SUCCESS;
});

afterEach(() => {
  delete process.env.RAPITAS_EVIDENCE_ROUTING;
  delete process.env.RAPITAS_EVIDENCE_MIN_SAMPLES;
  delete process.env.RAPITAS_EVIDENCE_MIN_SUCCESS;
});

describe('getRoleModelOutcomes', () => {
  test('aggregates per-model samples, successes, rate, and tier', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([
        ...rows('claude-haiku-4-5-20251001', 10, 1),
        ...rows('claude-sonnet-4-6', 4),
      ]),
    );

    const outcomes = await getRoleModelOutcomes('implementer');
    expect(outcomes).toHaveLength(2);
    const haiku = outcomes[0]; // most-sampled first
    expect(haiku.modelName).toBe('claude-haiku-4-5-20251001');
    expect(haiku.tier).toBe('economy');
    expect(haiku.samples).toBe(10);
    expect(haiku.successes).toBe(9);
    expect(haiku.successRate).toBeCloseTo(0.9);
    expect(outcomes[1].tier).toBe('standard');
  });

  test('counts an errorMessage row as a failure even when status=completed', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([
        { status: 'completed', errorMessage: 'boom', modelName: 'claude-haiku-4-5-20251001' },
      ]),
    );
    const outcomes = await getRoleModelOutcomes('verifier');
    expect(outcomes[0].successes).toBe(0);
  });
});

describe('resolveProvenTier', () => {
  test('returns the tier of a model with enough high-success samples', async () => {
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 10)));
    expect(await resolveProvenTier('implementer')).toBe('economy');
  });

  test('returns undefined below the sample threshold', async () => {
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 7)));
    expect(await resolveProvenTier('planner')).toBeUndefined();
  });

  test('returns undefined below the success-rate threshold', async () => {
    // 8 samples, 2 failures → 75% < 90%
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 8, 2)));
    expect(await resolveProvenTier('implementer')).toBeUndefined();
  });

  test('picks the CHEAPEST proven tier when several qualify', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([...rows('claude-sonnet-4-6', 20), ...rows('claude-haiku-4-5-20251001', 10)]),
    );
    expect(await resolveProvenTier('implementer')).toBe('economy');
  });

  test('kill switch RAPITAS_EVIDENCE_ROUTING=0 disables resolution', async () => {
    process.env.RAPITAS_EVIDENCE_ROUTING = '0';
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 20)));
    expect(await resolveProvenTier('implementer')).toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });

  test('thresholds are tunable via env', async () => {
    process.env.RAPITAS_EVIDENCE_MIN_SAMPLES = '5';
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 5)));
    expect(await resolveProvenTier('planner')).toBe('economy');
  });

  test('caches per role until reset (single DB query for repeat calls)', async () => {
    findMany.mockImplementation(() => Promise.resolve(rows('claude-haiku-4-5-20251001', 10)));
    await resolveProvenTier('implementer');
    await resolveProvenTier('implementer');
    expect(findMany).toHaveBeenCalledTimes(1);
    _resetProvenTierCache();
    await resolveProvenTier('implementer');
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
