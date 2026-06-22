/**
 * parallel-test.test.ts
 *
 * Unit tests for the pure functions exported by scripts/parallel-test.ts.
 * Covers: resolveConcurrency, aggregateExitCode, formatProgressLine.
 * The Bun.spawn-based runFile is excluded (I/O; not mocked or tested here).
 */

import { describe, test, expect } from 'bun:test';
import { resolveConcurrency, aggregateExitCode, formatProgressLine } from './parallel-test';
import type { TestResult } from './parallel-test';

/** Helper to build a minimal TestResult fixture. */
function makeResult(exitCode: number, file = 'some.test.ts'): TestResult {
  return { file, exitCode, stdout: '', stderr: '', elapsedMs: 100 };
}

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

  test('clamps to 1 for zero env value', () => {
    expect(resolveConcurrency('0', 8)).toBe(1);
  });

  test('clamps to 1 for negative env value', () => {
    expect(resolveConcurrency('-3', 8)).toBe(1);
    expect(resolveConcurrency('-1', 4)).toBe(1);
  });

  test('clamps to 1 for non-numeric env value', () => {
    expect(resolveConcurrency('abc', 8)).toBe(1);
    expect(resolveConcurrency('NaN', 8)).toBe(1);
  });

  test('clamps to 1 for "Infinity" env value', () => {
    // NOTE: parseInt('Infinity', 10) → NaN, so it falls back to 1.
    expect(resolveConcurrency('Infinity', 8)).toBe(1);
  });

  test('ensures minimum of 1 when cpuCount is 0 or 1', () => {
    expect(resolveConcurrency(undefined, 0)).toBe(1);
    expect(resolveConcurrency(undefined, 1)).toBe(1);
  });
});

describe('aggregateExitCode', () => {
  test('returns 0 for empty results array', () => {
    expect(aggregateExitCode([])).toBe(0);
  });

  test('returns 0 when all tests pass', () => {
    expect(aggregateExitCode([makeResult(0), makeResult(0), makeResult(0)])).toBe(0);
  });

  test('returns first non-zero exit code encountered', () => {
    const results = [makeResult(0), makeResult(1), makeResult(2)];
    expect(aggregateExitCode(results)).toBe(1);
  });

  test('returns the leading non-zero code when it is not 1', () => {
    expect(aggregateExitCode([makeResult(2), makeResult(1)])).toBe(2);
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
