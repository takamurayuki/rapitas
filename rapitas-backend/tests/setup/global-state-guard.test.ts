/**
 * global-state-guard.test.ts
 *
 * Unit tests for the pure functions exported by tests/setup/global-state-guard.ts.
 * Tests run in isolation against mock snapshots without touching actual globals.
 */

import { describe, test, expect } from 'bun:test';
import {
  takeSnapshot,
  diffSnapshots,
  formatLeakWarnings,
  type GlobalSnapshot,
  type SnapshotDiff,
} from './global-state-guard';

/** Builds a minimal GlobalSnapshot for test setup. */
function makeSnapshot(overrides?: {
  functions?: Partial<GlobalSnapshot['functions']>;
  env?: Record<string, string | undefined>;
}): GlobalSnapshot {
  const base: GlobalSnapshot = {
    functions: {
      fetch: globalThis.fetch,
      setTimeout: global.setTimeout,
      setInterval: global.setInterval,
      processExit: process.exit,
    },
    env: {},
  };
  if (overrides?.functions) {
    Object.assign(base.functions, overrides.functions);
  }
  if (overrides?.env) {
    base.env = { ...overrides.env };
  }
  return base;
}

describe('takeSnapshot', () => {
  test('returns an object with functions and env properties', () => {
    const snapshot = takeSnapshot();
    expect(snapshot).toHaveProperty('functions');
    expect(snapshot).toHaveProperty('env');
  });

  test('env is a shallow copy of process.env', () => {
    const key = '__GUARD_TEST_KEY__';
    process.env[key] = 'before';
    const snapshot = takeSnapshot();
    process.env[key] = 'after';
    // The snapshot should preserve the value at the time of capture.
    expect(snapshot.env[key]).toBe('before');
    delete process.env[key];
  });

  test('captures globalThis.fetch reference', () => {
    const snapshot = takeSnapshot();
    expect(snapshot.functions.fetch).toBe(globalThis.fetch);
  });
});

describe('diffSnapshots', () => {
  describe('function reference tracking', () => {
    test('returns empty diffs when nothing changed', () => {
      const snap = makeSnapshot();
      expect(diffSnapshots(snap, snap)).toEqual([]);
    });

    // eslint-disable-next-line local/prefer-test-each-for-similar -- fetch case also asserts the exact `after` function reference via array indexing; setTimeout/process.exit use find() with fewer checks, not one uniform shape
    test('detects fetch reference change', () => {
      const mockFetch = () => Promise.resolve(new Response());
      const before = makeSnapshot({ functions: { fetch: globalThis.fetch } });
      const after = makeSnapshot({ functions: { fetch: mockFetch } });
      const diffs = diffSnapshots(before, after);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].key).toBe('fetch');
      expect(diffs[0].kind).toBe('function_changed');
      expect(diffs[0].after).toBe(mockFetch);
    });

    test('detects setTimeout reference change', () => {
      const original = global.setTimeout;
      const fake = (() => {}) as unknown as typeof setTimeout;
      const before = makeSnapshot({ functions: { setTimeout: original } });
      const after = makeSnapshot({ functions: { setTimeout: fake } });
      const diffs = diffSnapshots(before, after);
      const match = diffs.find((d) => d.key === 'setTimeout');
      expect(match).toBeDefined();
      expect(match?.kind).toBe('function_changed');
    });

    test('detects process.exit reference change', () => {
      const original = process.exit;
      const fakeExit = (() => {}) as never;
      const before = makeSnapshot({ functions: { processExit: original } });
      const after = makeSnapshot({ functions: { processExit: fakeExit } });
      const diffs = diffSnapshots(before, after);
      const match = diffs.find((d) => d.key === 'process.exit');
      expect(match).toBeDefined();
      expect(match?.kind).toBe('function_changed');
    });

    test('skips keys that were undefined in both snapshots', () => {
      const before = makeSnapshot({ functions: { fetch: undefined } });
      const after = makeSnapshot({ functions: { fetch: undefined } });
      const diffs = diffSnapshots(before, after);
      expect(diffs.find((d) => d.key === 'fetch')).toBeUndefined();
    });

    test('detects when a function goes from defined to undefined', () => {
      const before = makeSnapshot({ functions: { fetch: globalThis.fetch } });
      const after = makeSnapshot({ functions: { fetch: undefined } });
      const diffs = diffSnapshots(before, after);
      expect(diffs.find((d) => d.key === 'fetch')).toBeDefined();
    });
  });

  describe('process.env tracking', () => {
    test.each([
      {
        label: 'key addition',
        beforeEnv: {},
        afterEnv: { NEW_KEY: 'value' },
        expectedKey: 'process.env.NEW_KEY',
        expectedKind: 'env_added',
        expectedBefore: undefined as string | undefined,
        expectedAfter: 'value' as string | undefined,
        checkValues: true,
      },
      {
        label: 'key removal',
        beforeEnv: { OLD_KEY: 'value' },
        afterEnv: {},
        expectedKey: 'process.env.OLD_KEY',
        expectedKind: 'env_removed',
        expectedBefore: 'value' as string | undefined,
        expectedAfter: undefined as string | undefined,
        checkValues: true,
      },
      {
        label: 'value change',
        beforeEnv: { API_KEY: 'old' },
        afterEnv: { API_KEY: 'new' },
        expectedKey: 'process.env.API_KEY',
        expectedKind: 'env_changed',
        expectedBefore: undefined as string | undefined,
        expectedAfter: undefined as string | undefined,
        checkValues: false,
      },
    ])(
      'detects env $label',
      ({
        beforeEnv,
        afterEnv,
        expectedKey,
        expectedKind,
        expectedBefore,
        expectedAfter,
        checkValues,
      }) => {
        const before = makeSnapshot({ env: beforeEnv });
        const after = makeSnapshot({ env: afterEnv });
        const diffs = diffSnapshots(before, after);
        expect(diffs).toHaveLength(1);
        expect(diffs[0].key).toBe(expectedKey);
        expect(diffs[0].kind).toBe(expectedKind);
        // value checks only apply to the addition/removal cases, matching the original per-case assertions
        if (checkValues) {
          expect(diffs[0].before).toBe(expectedBefore);
          expect(diffs[0].after).toBe(expectedAfter);
        }
      },
    );

    test('returns no diff for unchanged env', () => {
      const env = { STABLE: 'value' };
      const before = makeSnapshot({ env });
      const after = makeSnapshot({ env });
      const diffs = diffSnapshots(before, after);
      expect(diffs.find((d) => d.key === 'process.env.STABLE')).toBeUndefined();
    });

    test('detects incomplete restoration (delete-only, not value-save)', () => {
      // Simulates the search-miss-service pattern: sets a key then deletes it
      // without restoring the original value.
      const before = makeSnapshot({ env: { DB_PROVIDER: 'postgres' } });
      const after = makeSnapshot({ env: {} });
      const diffs = diffSnapshots(before, after);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].kind).toBe('env_removed');
    });
  });

  describe('combined state', () => {
    test('returns empty diff for fully clean state', () => {
      const snap = makeSnapshot({ env: { STABLE: 'val' } });
      expect(diffSnapshots(snap, snap)).toHaveLength(0);
    });

    test('reports multiple diffs when multiple keys changed', () => {
      const mockFetch = () => Promise.resolve(new Response());
      const before = makeSnapshot({ functions: { fetch: globalThis.fetch }, env: {} });
      const after = makeSnapshot({
        functions: { fetch: mockFetch },
        env: { EXTRA_KEY: 'oops' },
      });
      const diffs = diffSnapshots(before, after);
      expect(diffs.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('formatLeakWarnings', () => {
  const diffs: SnapshotDiff[] = [
    { key: 'fetch', kind: 'function_changed', before: undefined, after: undefined },
    { key: 'process.env.API_KEY', kind: 'env_added', before: undefined, after: 'secret' },
    { key: 'process.env.DB', kind: 'env_removed', before: 'pg', after: undefined },
    { key: 'process.env.URL', kind: 'env_changed', before: 'old', after: 'new' },
  ];

  test('returns one warning string per diff', () => {
    const warnings = formatLeakWarnings(diffs);
    expect(warnings).toHaveLength(diffs.length);
  });

  test('each warning starts with the guard prefix', () => {
    for (const w of formatLeakWarnings(diffs)) {
      expect(w).toMatch(/^\[global-state-guard\]/);
    }
  });

  // eslint-disable-next-line local/prefer-test-each-for-similar -- indexed multi-assertion checks (this test and the next) vs a loop-based single-assertion check with an extra testLabel arg (the third) aren't one uniform shape
  test('includes the changed key in each warning', () => {
    const warnings = formatLeakWarnings(diffs);
    expect(warnings[0]).toContain('fetch');
    expect(warnings[1]).toContain('API_KEY');
    expect(warnings[2]).toContain('DB');
    expect(warnings[3]).toContain('URL');
  });

  test('includes kind labels in warnings', () => {
    const warnings = formatLeakWarnings(diffs);
    expect(warnings[0]).toContain('reference changed');
    expect(warnings[1]).toContain('added');
    expect(warnings[2]).toContain('removed');
    expect(warnings[3]).toContain('value changed');
  });

  test('includes optional test label when provided', () => {
    const warnings = formatLeakWarnings(diffs, 'my-test');
    for (const w of warnings) {
      expect(w).toContain('[my-test]');
    }
  });

  test('omits label bracket when testLabel is not provided', () => {
    const warnings = formatLeakWarnings(diffs);
    for (const w of warnings) {
      expect(w).not.toContain('in [');
    }
  });

  test('returns empty array for empty diffs', () => {
    expect(formatLeakWarnings([])).toEqual([]);
  });

  test('does not throw for any diff kind', () => {
    const allKinds: SnapshotDiff[] = [
      { key: 'k1', kind: 'function_changed', before: null, after: null },
      { key: 'k2', kind: 'env_added', before: undefined, after: 'v' },
      { key: 'k3', kind: 'env_removed', before: 'v', after: undefined },
      { key: 'k4', kind: 'env_changed', before: 'a', after: 'b' },
    ];
    expect(() => formatLeakWarnings(allKinds)).not.toThrow();
  });
});
