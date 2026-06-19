/**
 * global-state-guard.ts
 *
 * Detects global state leaks between tests by snapshotting watched globals
 * before each test and comparing after. Emits console.warn on diff — never throws,
 * so existing test pass/fail status is unaffected.
 *
 * This file is registered as a preload in bunfig.toml and applies to all test files.
 * Pure functions (takeSnapshot, diffSnapshots, formatLeakWarnings) are exported
 * for unit testing independent of the preload side-effects.
 */

import { beforeEach, afterEach } from 'bun:test';

/** Prefix used in all warning messages so CI logs can be grepped reliably. */
const WARN_PREFIX = '[global-state-guard]';

/** Global function keys on `global`/`globalThis` monitored for reference changes. */
const WATCHED_FUNCTION_KEYS = ['fetch', 'setTimeout', 'setInterval'] as const;
type WatchedFunctionKey = (typeof WATCHED_FUNCTION_KEYS)[number];

/** Snapshot of watched global function references and process.exit. */
export type FunctionSnapshot = Record<WatchedFunctionKey, unknown> & {
  processExit: unknown;
};

/** Shallow copy of process.env at a point in time. */
export type EnvSnapshot = Record<string, string | undefined>;

/** Combined snapshot of all watched global state. */
export type GlobalSnapshot = {
  /** Function references for watched globals */
  functions: FunctionSnapshot;
  /** Shallow copy of process.env */
  env: EnvSnapshot;
};

/** Describes a single detected state change between two snapshots. */
export type SnapshotDiff = {
  /** Human-readable key identifying what changed */
  key: string;
  /** Category of the change */
  kind: 'function_changed' | 'env_added' | 'env_removed' | 'env_changed';
  /** State before the test ran */
  before: unknown;
  /** State after the test ran */
  after: unknown;
};

/**
 * Captures the current state of watched globals.
 *
 * @returns Snapshot of global function references and process.env / グローバル状態のスナップショット
 */
export function takeSnapshot(): GlobalSnapshot {
  return {
    functions: {
      fetch: globalThis.fetch,
      setTimeout: global.setTimeout,
      setInterval: global.setInterval,
      processExit: process.exit,
    },
    env: { ...process.env } as EnvSnapshot,
  };
}

/**
 * Compares two snapshots and returns all detected differences.
 *
 * - Function references are compared by identity (===).
 * - process.env entries are compared by value, distinguishing add/remove/change.
 * - Keys that were undefined in both snapshots are silently skipped.
 *
 * @param before - Snapshot taken before the test / テスト前のスナップショット
 * @param after - Snapshot taken after the test / テスト後のスナップショット
 * @returns Array of differences; empty when no state leaked
 */
export function diffSnapshots(before: GlobalSnapshot, after: GlobalSnapshot): SnapshotDiff[] {
  const diffs: SnapshotDiff[] = [];

  // Compare watched function references.
  for (const key of WATCHED_FUNCTION_KEYS) {
    const bVal = before.functions[key];
    const aVal = after.functions[key];
    if (bVal === undefined && aVal === undefined) continue;
    if (bVal !== aVal) {
      diffs.push({ key, kind: 'function_changed', before: bVal, after: aVal });
    }
  }

  // process.exit lives on `process`, not `global`, so check separately.
  const exitBefore = before.functions.processExit;
  const exitAfter = after.functions.processExit;
  if (!(exitBefore === undefined && exitAfter === undefined) && exitBefore !== exitAfter) {
    diffs.push({
      key: 'process.exit',
      kind: 'function_changed',
      before: exitBefore,
      after: exitAfter,
    });
  }

  // Compare process.env: additions, removals, and value changes.
  const allEnvKeys = Array.from(new Set([...Object.keys(before.env), ...Object.keys(after.env)]));
  for (const key of allEnvKeys) {
    const bVal = before.env[key];
    const aVal = after.env[key];
    if (bVal === aVal) continue;

    if (bVal === undefined) {
      diffs.push({ key: `process.env.${key}`, kind: 'env_added', before: bVal, after: aVal });
    } else if (aVal === undefined) {
      diffs.push({ key: `process.env.${key}`, kind: 'env_removed', before: bVal, after: aVal });
    } else {
      diffs.push({ key: `process.env.${key}`, kind: 'env_changed', before: bVal, after: aVal });
    }
  }

  return diffs;
}

/**
 * Formats diff entries into human-readable warning strings.
 *
 * @param diffs - Detected state changes / 検出された状態差分
 * @param testLabel - Optional label identifying the test context / テストコンテキストの識別ラベル（省略可）
 * @returns Array of warning strings, one per diff entry
 */
export function formatLeakWarnings(diffs: SnapshotDiff[], testLabel?: string): string[] {
  const kindLabel: Record<SnapshotDiff['kind'], string> = {
    function_changed: 'reference changed',
    env_added: 'added',
    env_removed: 'removed',
    env_changed: 'value changed',
  };
  return diffs.map((d) => {
    const context = testLabel ? ` in [${testLabel}]` : '';
    return `${WARN_PREFIX} "${d.key}" ${kindLabel[d.kind]}${context}`;
  });
}

// ---------------------------------------------------------------------------
// Preload side-effect: register global beforeEach/afterEach hooks.
// These hooks are observation-only — they never throw or alter test results.
// ---------------------------------------------------------------------------

let snapshot: GlobalSnapshot | null = null;

beforeEach(() => {
  snapshot = takeSnapshot();
});

afterEach(() => {
  if (snapshot === null) return;
  const after = takeSnapshot();
  const diffs = diffSnapshots(snapshot, after);
  for (const warning of formatLeakWarnings(diffs)) {
    console.warn(warning);
  }
  snapshot = null;
});
