/**
 * retry-policy.test.ts
 *
 * Unit tests for scripts/retry-policy.ts.
 * Covers all pure functions and the I/O helpers (using tmpdir fixtures).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, sep } from 'path';
import { tmpdir } from 'os';
import {
  parseRetryPolicyConfig,
  computeFlakeRate,
  resolveFileRetryCount,
  updateFlakeHistory,
  pruneFlakeHistory,
  getFlakeHistoryPath,
  loadFlakeHistoryOrEmpty,
  saveFlakeHistory,
} from './retry-policy';
import type { FlakeHistoryFile, RetryPolicyConfig } from './retry-policy';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyHistory(): FlakeHistoryFile {
  return { version: 1, updatedAt: '', entries: {} };
}

function historyWithEntry(file: string, runCount: number, flakeCount: number): FlakeHistoryFile {
  return {
    version: 1,
    updatedAt: '2025-01-01T00:00:00Z',
    entries: {
      [file]: { runCount, flakeCount, lastSeenAt: '2025-01-01T00:00:00Z' },
    },
  };
}

function defaultConfig(overrides: Partial<RetryPolicyConfig> = {}): RetryPolicyConfig {
  return {
    enabled: true,
    historyWindow: 10,
    highThreshold: 0.2,
    flakeExtraRetries: 2,
    highFlakePatterns: [],
    ...overrides,
  };
}

// ─── parseRetryPolicyConfig ──────────────────────────────────────────────────

describe('parseRetryPolicyConfig', () => {
  test('disabled when RAPITAS_TEST_ADAPTIVE_RETRY is unset', () => {
    expect(parseRetryPolicyConfig({}).enabled).toBe(false);
  });

  test('disabled when RAPITAS_TEST_ADAPTIVE_RETRY=0', () => {
    expect(parseRetryPolicyConfig({ RAPITAS_TEST_ADAPTIVE_RETRY: '0' }).enabled).toBe(false);
  });

  test('enabled when RAPITAS_TEST_ADAPTIVE_RETRY=1', () => {
    expect(parseRetryPolicyConfig({ RAPITAS_TEST_ADAPTIVE_RETRY: '1' }).enabled).toBe(true);
  });

  test('historyWindow defaults to 10', () => {
    expect(parseRetryPolicyConfig({}).historyWindow).toBe(10);
  });

  test('historyWindow parsed from env', () => {
    expect(parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_WINDOW: '20' }).historyWindow).toBe(20);
  });

  test('historyWindow falls back to 10 for invalid values', () => {
    expect(parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_WINDOW: 'abc' }).historyWindow).toBe(10);
    expect(parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_WINDOW: '-5' }).historyWindow).toBe(10);
    expect(parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_WINDOW: '0' }).historyWindow).toBe(10);
  });

  test('highThreshold defaults to 0.2', () => {
    expect(parseRetryPolicyConfig({}).highThreshold).toBe(0.2);
  });

  test('highThreshold parsed from env', () => {
    expect(parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_HIGH_THRESHOLD: '0.5' }).highThreshold).toBe(
      0.5,
    );
  });

  test('highThreshold falls back to 0.2 for out-of-range values', () => {
    expect(
      parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_HIGH_THRESHOLD: '-0.1' }).highThreshold,
    ).toBe(0.2);
    expect(parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_HIGH_THRESHOLD: '1.5' }).highThreshold).toBe(
      0.2,
    );
    expect(parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_HIGH_THRESHOLD: 'bad' }).highThreshold).toBe(
      0.2,
    );
  });

  test('flakeExtraRetries defaults to 2', () => {
    expect(parseRetryPolicyConfig({}).flakeExtraRetries).toBe(2);
  });

  test('flakeExtraRetries parsed from env', () => {
    expect(
      parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_EXTRA_RETRIES: '5' }).flakeExtraRetries,
    ).toBe(5);
  });

  test('flakeExtraRetries falls back to 2 for negative values', () => {
    expect(
      parseRetryPolicyConfig({ RAPITAS_TEST_FLAKE_EXTRA_RETRIES: '-1' }).flakeExtraRetries,
    ).toBe(2);
  });

  test('highFlakePatterns is empty array when env unset', () => {
    expect(parseRetryPolicyConfig({}).highFlakePatterns).toEqual([]);
  });

  test('highFlakePatterns parses comma-separated regexes', () => {
    const config = parseRetryPolicyConfig({
      RAPITAS_TEST_HIGH_FLAKE_PATTERNS: 'integration,.*network.*',
    });
    expect(config.highFlakePatterns).toHaveLength(2);
    expect(config.highFlakePatterns[0]?.test('tests/integration/foo.ts')).toBe(true);
    expect(config.highFlakePatterns[1]?.test('services/network-client.test.ts')).toBe(true);
  });

  test('highFlakePatterns skips invalid regex silently', () => {
    // "[invalid" is an invalid regex
    const config = parseRetryPolicyConfig({
      RAPITAS_TEST_HIGH_FLAKE_PATTERNS: 'valid,([invalid',
    });
    expect(config.highFlakePatterns).toHaveLength(1);
    expect(config.highFlakePatterns[0]?.test('valid-file.ts')).toBe(true);
  });
});

// ─── computeFlakeRate ────────────────────────────────────────────────────────

describe('computeFlakeRate', () => {
  test('returns 0 when runCount is 0 (no division by zero)', () => {
    expect(computeFlakeRate({ runCount: 0, flakeCount: 0, lastSeenAt: '' })).toBe(0);
  });

  test('returns 0 when flakeCount is 0', () => {
    expect(computeFlakeRate({ runCount: 10, flakeCount: 0, lastSeenAt: '' })).toBe(0);
  });

  test('returns 1 when all runs were flaky', () => {
    expect(computeFlakeRate({ runCount: 5, flakeCount: 5, lastSeenAt: '' })).toBe(1);
  });

  test('returns 0.5 for equal split', () => {
    expect(computeFlakeRate({ runCount: 4, flakeCount: 2, lastSeenAt: '' })).toBe(0.5);
  });

  test('returns correct fractional value', () => {
    expect(computeFlakeRate({ runCount: 10, flakeCount: 3, lastSeenAt: '' })).toBeCloseTo(0.3);
  });
});

// ─── resolveFileRetryCount ───────────────────────────────────────────────────

describe('resolveFileRetryCount', () => {
  const file = 'services/foo.test.ts';
  const globalRetry = 1;

  test('returns globalRetry when adaptive is disabled', () => {
    const config = defaultConfig({ enabled: false });
    const history = historyWithEntry(file, 10, 5);
    expect(resolveFileRetryCount(file, globalRetry, history, config)).toBe(globalRetry);
  });

  test('returns globalRetry + extra when file matches a highFlakePattern', () => {
    const config = defaultConfig({
      highFlakePatterns: [/integration/],
      flakeExtraRetries: 3,
    });
    expect(
      resolveFileRetryCount('tests/integration/foo.ts', globalRetry, emptyHistory(), config),
    ).toBe(globalRetry + 3);
  });

  test('returns globalRetry when no history entry exists', () => {
    const config = defaultConfig();
    expect(resolveFileRetryCount(file, globalRetry, emptyHistory(), config)).toBe(globalRetry);
  });

  test('returns globalRetry + extra for high flake rate', () => {
    const config = defaultConfig({ highThreshold: 0.2, flakeExtraRetries: 2 });
    // 4/10 = 0.4 >= 0.2 threshold
    const history = historyWithEntry(file, 10, 4);
    expect(resolveFileRetryCount(file, globalRetry, history, config)).toBe(globalRetry + 2);
  });

  test('returns 0 for stable file with full window', () => {
    const config = defaultConfig({ historyWindow: 10, highThreshold: 0.2 });
    // runCount=10, flakeCount=0 → rate=0, window full → stable
    const history = historyWithEntry(file, 10, 0);
    expect(resolveFileRetryCount(file, globalRetry, history, config)).toBe(0);
  });

  test('does NOT return 0 for stable file with partial window', () => {
    const config = defaultConfig({ historyWindow: 10, highThreshold: 0.2 });
    // runCount=3, flakeCount=0 → rate=0 but window not full
    const history = historyWithEntry(file, 3, 0);
    expect(resolveFileRetryCount(file, globalRetry, history, config)).toBe(globalRetry);
  });

  test('returns globalRetry for mid-range flake rate', () => {
    const config = defaultConfig({ historyWindow: 10, highThreshold: 0.3, flakeExtraRetries: 2 });
    // 2/10 = 0.2 < 0.3 threshold, and not 0 → middle ground
    const history = historyWithEntry(file, 10, 2);
    expect(resolveFileRetryCount(file, globalRetry, history, config)).toBe(globalRetry);
  });

  test('globalRetry=0 with high-flake file still gets extra retries', () => {
    const config = defaultConfig({ highThreshold: 0.2, flakeExtraRetries: 2 });
    const history = historyWithEntry(file, 10, 5);
    expect(resolveFileRetryCount(file, 0, history, config)).toBe(2);
  });
});

// ─── updateFlakeHistory ──────────────────────────────────────────────────────

describe('updateFlakeHistory', () => {
  const now = '2025-06-01T00:00:00Z';

  test('adds new entry for a file not in history', () => {
    const result = updateFlakeHistory(
      emptyHistory(),
      [{ file: 'a.test.ts', elapsedMs: 100, exitCode: 0, attempts: 1, flaky: false }],
      now,
    );
    expect(result.entries['a.test.ts']).toEqual({
      runCount: 1,
      flakeCount: 0,
      lastSeenAt: now,
    });
  });

  test('increments flakeCount when result.flaky is true', () => {
    const result = updateFlakeHistory(
      emptyHistory(),
      [{ file: 'b.test.ts', elapsedMs: 200, exitCode: 0, attempts: 2, flaky: true }],
      now,
    );
    expect(result.entries['b.test.ts']?.flakeCount).toBe(1);
  });

  test('increments runCount without incrementing flakeCount for non-flaky result', () => {
    const history = historyWithEntry('c.test.ts', 5, 2);
    const result = updateFlakeHistory(
      history,
      [{ file: 'c.test.ts', elapsedMs: 150, exitCode: 0, attempts: 1, flaky: false }],
      now,
    );
    expect(result.entries['c.test.ts']).toEqual({
      runCount: 6,
      flakeCount: 2,
      lastSeenAt: now,
    });
  });

  test('increments both runCount and flakeCount for flaky result', () => {
    const history = historyWithEntry('d.test.ts', 5, 1);
    const result = updateFlakeHistory(
      history,
      [{ file: 'd.test.ts', elapsedMs: 300, exitCode: 0, attempts: 2, flaky: true }],
      now,
    );
    expect(result.entries['d.test.ts']).toEqual({
      runCount: 6,
      flakeCount: 2,
      lastSeenAt: now,
    });
  });

  test('does not mutate the input history', () => {
    const original = emptyHistory();
    updateFlakeHistory(
      original,
      [{ file: 'x.test.ts', elapsedMs: 100, exitCode: 0, attempts: 1, flaky: false }],
      now,
    );
    expect(original.entries).toEqual({});
  });

  test('handles multiple results in one call', () => {
    const result = updateFlakeHistory(
      emptyHistory(),
      [
        { file: 'e.test.ts', elapsedMs: 100, exitCode: 0, attempts: 1, flaky: false },
        { file: 'f.test.ts', elapsedMs: 200, exitCode: 0, attempts: 2, flaky: true },
      ],
      now,
    );
    expect(result.entries['e.test.ts']?.runCount).toBe(1);
    expect(result.entries['f.test.ts']?.flakeCount).toBe(1);
  });
});

// ─── pruneFlakeHistory ───────────────────────────────────────────────────────

describe('pruneFlakeHistory', () => {
  test('does not change entries within the window', () => {
    const history = historyWithEntry('a.test.ts', 8, 2);
    const result = pruneFlakeHistory(history, 10);
    expect(result.entries['a.test.ts']).toEqual(history.entries['a.test.ts']);
  });

  test('caps runCount to window and scales flakeCount proportionally', () => {
    const history = historyWithEntry('b.test.ts', 15, 3);
    const result = pruneFlakeHistory(history, 10);
    // flakeCount = round(3 * 10 / 15) = round(2) = 2
    expect(result.entries['b.test.ts']).toMatchObject({
      runCount: 10,
      flakeCount: 2,
    });
  });

  test('preserves flake rate after pruning', () => {
    const history = historyWithEntry('c.test.ts', 20, 4);
    const result = pruneFlakeHistory(history, 10);
    // original rate = 4/20 = 0.2; after pruning: round(4*10/20)=2 → 2/10 = 0.2
    const entry = result.entries['c.test.ts'];
    if (entry) {
      expect(computeFlakeRate(entry)).toBeCloseTo(0.2);
    }
  });

  test('does not mutate the input history', () => {
    const history = historyWithEntry('d.test.ts', 20, 4);
    pruneFlakeHistory(history, 10);
    expect(history.entries['d.test.ts']?.runCount).toBe(20);
  });

  test('handles zero flakeCount', () => {
    const history = historyWithEntry('e.test.ts', 20, 0);
    const result = pruneFlakeHistory(history, 10);
    expect(result.entries['e.test.ts']).toMatchObject({ runCount: 10, flakeCount: 0 });
  });
});

// ─── getFlakeHistoryPath ─────────────────────────────────────────────────────

describe('getFlakeHistoryPath', () => {
  let savedExplicit: string | undefined;
  let savedDataDir: string | undefined;

  beforeEach(() => {
    savedExplicit = process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH;
    savedDataDir = process.env.RAPITAS_DATA_DIR;
    delete process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH;
    delete process.env.RAPITAS_DATA_DIR;
  });

  afterEach(() => {
    if (savedExplicit === undefined) delete process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH;
    else process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH = savedExplicit;
    if (savedDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = savedDataDir;
  });

  test('returns RAPITAS_TEST_FLAKE_HISTORY_PATH when set (highest priority)', () => {
    process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH = '/explicit/flake.json';
    process.env.RAPITAS_DATA_DIR = '/should/be/ignored';
    expect(getFlakeHistoryPath('/backend')).toBe('/explicit/flake.json');
  });

  test('uses RAPITAS_DATA_DIR when explicit path is unset', () => {
    process.env.RAPITAS_DATA_DIR = '/data';
    const result = getFlakeHistoryPath('/backend');
    expect(result).toContain('.rapitas-flake-history.json');
    // Normalize separators for cross-platform comparison
    expect(result.replace(/\\/g, '/')).toContain('/data');
  });

  test('falls back to backendRoot when neither env is set', () => {
    const result = getFlakeHistoryPath('/backend');
    expect(result).toContain('.rapitas-flake-history.json');
    // Normalize separators for cross-platform comparison
    expect(result.replace(/\\/g, '/')).toContain('/backend');
  });
});

// ─── loadFlakeHistoryOrEmpty / saveFlakeHistory ──────────────────────────────

describe('loadFlakeHistoryOrEmpty / saveFlakeHistory', () => {
  let tmpDir: string;
  let savedExplicit: string | undefined;

  beforeEach(() => {
    savedExplicit = process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH;
    tmpDir = mkdtempSync(join(tmpdir(), 'retry-policy-'));
    process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH = join(tmpDir, 'flake-history.json');
  });

  afterEach(() => {
    if (savedExplicit === undefined) delete process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH;
    else process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH = savedExplicit;
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('loadFlakeHistoryOrEmpty returns empty history when file does not exist', () => {
    const result = loadFlakeHistoryOrEmpty(tmpDir);
    expect(result.version).toBe(1);
    expect(result.entries).toEqual({});
  });

  test('loadFlakeHistoryOrEmpty returns empty history on JSON parse error', () => {
    writeFileSync(join(tmpDir, 'flake-history.json'), 'not json', 'utf-8');
    const result = loadFlakeHistoryOrEmpty(tmpDir);
    expect(result.entries).toEqual({});
  });

  test('saveFlakeHistory writes a readable file', () => {
    const history = historyWithEntry('services/foo.test.ts', 5, 1);
    saveFlakeHistory(history, tmpDir);
    const loaded = loadFlakeHistoryOrEmpty(tmpDir);
    expect(loaded.entries['services/foo.test.ts']).toMatchObject({
      runCount: 5,
      flakeCount: 1,
    });
  });

  test('round-trip preserves all fields', () => {
    const history: FlakeHistoryFile = {
      version: 1,
      updatedAt: '2025-06-01T00:00:00Z',
      entries: {
        'a.test.ts': { runCount: 10, flakeCount: 3, lastSeenAt: '2025-05-01T00:00:00Z' },
        'b.test.ts': { runCount: 5, flakeCount: 0, lastSeenAt: '2025-05-15T00:00:00Z' },
      },
    };
    saveFlakeHistory(history, tmpDir);
    const loaded = loadFlakeHistoryOrEmpty(tmpDir);
    expect(loaded).toMatchObject(history);
  });

  test('saveFlakeHistory does not throw on write error (graceful)', () => {
    // Use a non-existent directory without RAPITAS_TEST_FLAKE_HISTORY_PATH override
    delete process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH;
    const nonExistentRoot = join(tmpDir, 'does-not-exist');
    expect(() => saveFlakeHistory(emptyHistory(), nonExistentRoot)).not.toThrow();
  });
});
