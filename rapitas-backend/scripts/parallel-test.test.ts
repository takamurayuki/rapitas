/**
 * parallel-test.test.ts
 *
 * Unit tests for the pure functions exported by scripts/parallel-test.ts.
 * Covers: resolveConcurrency, aggregateExitCode, formatProgressLine.
 * The Bun.spawn-based runFile is excluded (I/O; not mocked or tested here).
 */

import { describe, test, expect } from 'bun:test';
import {
  resolveConcurrency,
  aggregateExitCode,
  formatProgressLine,
  parseRetryCount,
  ranNoTests,
  formatSummaryLine,
} from './parallel-test';
import type { TestResult } from './parallel-test';

/** Helper to build a minimal TestResult fixture. */
function makeResult(exitCode: number, file = 'some.test.ts'): TestResult {
  return { file, exitCode, stdout: '', stderr: '', elapsedMs: 100 };
}

// 2026-10-07: five test files were erroring out at import — an incomplete
// mock.module mirror makes a named import fail to resolve, and bun reports that
// as "0 pass / 1 fail / 1 error", which inside a 1141-file log is
// indistinguishable from one bad assertion. 29 tests were silently not running.
// A file that executes ZERO tests is a coverage hole, not a failing assertion,
// and the summary has to say so.
describe('ranNoTests', () => {
  const loadError = `bun test v1.3.13
services/x.test.ts:
# Unhandled error between tests
SyntaxError: Export named 'execFile' not found in module 'node:child_process'.
 0 pass
 1 fail
 1 error
Ran 1 test across 1 file.`;

  const assertionFailure = `bun test v1.3.13
(fail) thing > does the thing
 13 pass
 1 fail
 28 expect() calls
Ran 14 tests across 1 file.`;

  test('is true for a file that errored before any test ran', () => {
    expect(ranNoTests(loadError, '')).toBe(true);
  });

  test('is false for a genuine assertion failure that still ran tests', () => {
    expect(ranNoTests(assertionFailure, '')).toBe(false);
  });

  test('is false for a passing file', () => {
    expect(ranNoTests(' 14 pass\n 0 fail\nRan 14 tests across 1 file.', '')).toBe(false);
  });

  test('reads stderr too — a crash can report there instead', () => {
    expect(ranNoTests('', 'error: Cannot find module "./missing"\n 0 pass\n')).toBe(true);
  });

  test('is false when nothing identifiable was printed, so a spawn failure is not mislabelled', () => {
    // An empty or truncated output is "unknown", not "zero tests ran" — calling
    // it a load error would put a spawn/timeout failure in the wrong bucket.
    expect(ranNoTests('', '')).toBe(false);
    expect(ranNoTests('[parallel-test] Spawn failed: Error', '')).toBe(false);
  });

  test('counts a 0-pass file even when bun prints no explicit error line', () => {
    expect(ranNoTests(' 0 pass\n 0 fail\nRan 0 tests across 1 file.', '')).toBe(true);
  });
});

describe('formatSummaryLine', () => {
  test('keeps the familiar shape when nothing failed to load', () => {
    expect(formatSummaryLine(1141, 0, 0, 82_500)).toBe(
      '[parallel-test] 1141 passed, 0 failed in 82.5s',
    );
  });

  test('names the zero-test files in the line everyone reads', () => {
    expect(formatSummaryLine(1136, 4, 2, 84_900)).toBe(
      '[parallel-test] 1136 passed, 4 failed (2 ran NO tests — import/mock error, not an assertion) in 84.9s',
    );
  });

  test('says nothing extra when every failure actually ran its tests', () => {
    expect(formatSummaryLine(1138, 2, 0, 80_000)).not.toContain('NO tests');
  });
});

describe('parseRetryCount', () => {
  test.each([
    { label: 'returns 0 for undefined', input: undefined, expected: 0 },
    { label: 'returns 0 for empty string', input: '', expected: 0 },
    { label: 'returns 0 for "0"', input: '0', expected: 0 },
    { label: 'returns positive integer for valid value: "1"', input: '1', expected: 1 },
    { label: 'returns positive integer for valid value: "3"', input: '3', expected: 3 },
    { label: 'returns positive integer for valid value: "10"', input: '10', expected: 10 },
    { label: 'returns 0 for negative value: "-1"', input: '-1', expected: 0 },
    { label: 'returns 0 for negative value: "-99"', input: '-99', expected: 0 },
    { label: 'returns 0 for non-numeric string: "abc"', input: 'abc', expected: 0 },
    { label: 'returns 0 for non-numeric string: "NaN"', input: 'NaN', expected: 0 },
    // parseInt('Infinity', 10) = NaN → falls back to 0
    { label: 'returns 0 for "Infinity"', input: 'Infinity', expected: 0 },
  ])('$label', ({ input, expected }) => {
    expect(parseRetryCount(input)).toBe(expected);
  });
});

describe('resolveConcurrency', () => {
  test('uses max(1, cpuCount-1) when env is undefined', () => {
    expect(resolveConcurrency(undefined, 4)).toBe(3);
    expect(resolveConcurrency(undefined, 2)).toBe(1);
    expect(resolveConcurrency(undefined, 1)).toBe(1);
  });

  test('uses max(1, cpuCount-1) when env is empty string', () => {
    expect(resolveConcurrency('', 8)).toBe(7);
  });

  test('parses valid positive integer from env', () => {
    expect(resolveConcurrency('4', 8)).toBe(4);
    expect(resolveConcurrency('1', 8)).toBe(1);
    expect(resolveConcurrency('16', 4)).toBe(16);
  });

  test.each([
    { label: 'clamps to 1 for zero env value', env: '0', cpuCount: 8 },
    { label: 'clamps to 1 for negative env value: "-3"', env: '-3', cpuCount: 8 },
    { label: 'clamps to 1 for negative env value: "-1"', env: '-1', cpuCount: 4 },
    { label: 'clamps to 1 for non-numeric env value: "abc"', env: 'abc', cpuCount: 8 },
    { label: 'clamps to 1 for non-numeric env value: "NaN"', env: 'NaN', cpuCount: 8 },
    // parseInt('Infinity', 10) → NaN, so it falls back to 1.
    { label: 'clamps to 1 for "Infinity" env value', env: 'Infinity', cpuCount: 8 },
  ])('$label', ({ env, cpuCount }) => {
    expect(resolveConcurrency(env, cpuCount)).toBe(1);
  });

  test('ensures minimum of 1 when cpuCount is 0 or 1', () => {
    expect(resolveConcurrency(undefined, 0)).toBe(1);
    expect(resolveConcurrency(undefined, 1)).toBe(1);
  });
});

describe('aggregateExitCode', () => {
  test.each([
    { label: 'returns 0 for empty results array', exitCodes: [], expected: 0 },
    { label: 'returns 0 when all tests pass', exitCodes: [0, 0, 0], expected: 0 },
    { label: 'returns first non-zero exit code encountered', exitCodes: [0, 1, 2], expected: 1 },
    {
      label: 'returns the leading non-zero code when it is not 1',
      exitCodes: [2, 1],
      expected: 2,
    },
  ])('$label', ({ exitCodes, expected }) => {
    expect(aggregateExitCode(exitCodes.map((code) => makeResult(code)))).toBe(expected);
  });

  test('normalises negative exit code to 1', () => {
    expect(aggregateExitCode([makeResult(-1)])).toBe(1);
    expect(aggregateExitCode([makeResult(-255)])).toBe(1);
  });

  test('returns 0 for a single passing result', () => {
    expect(aggregateExitCode([makeResult(0)])).toBe(0);
  });

  test('returns the exit code for a single failing result', () => {
    expect(aggregateExitCode([makeResult(3)])).toBe(3);
  });
});

describe('formatProgressLine', () => {
  test('formats PASS line correctly', () => {
    const line = formatProgressLine(1, 10, true, 'tests/foo.test.ts', 123.4);
    expect(line).toBe('[1/10] PASS tests/foo.test.ts (123ms)');
  });

  test('formats FAIL line correctly', () => {
    const line = formatProgressLine(5, 10, false, 'services/bar.test.ts', 456.7);
    expect(line).toBe('[5/10] FAIL services/bar.test.ts (457ms)');
  });

  test('handles index equals total (last file)', () => {
    const line = formatProgressLine(10, 10, true, 'last.test.ts', 50);
    expect(line).toBe('[10/10] PASS last.test.ts (50ms)');
  });

  test('rounds elapsed time via toFixed(0)', () => {
    const line = formatProgressLine(1, 1, true, 'a.test.ts', 999.9);
    expect(line).toContain('1000ms');
  });

  test('contains relPath verbatim', () => {
    const line = formatProgressLine(3, 20, false, 'deep/nested/file.test.ts', 200);
    expect(line).toContain('deep/nested/file.test.ts');
  });
});
