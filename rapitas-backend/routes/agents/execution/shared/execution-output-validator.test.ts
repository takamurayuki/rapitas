/**
 * Tests for execution-output-validator.
 *
 * These verify that we catch the well-known process-failure markers without
 * matching plain narration ("the agent said the test failed" should NOT trip).
 */

import { describe, expect, test } from 'bun:test';
import { detectExecutionFailures, hasExecutionFailures } from './execution-output-validator';

describe('detectExecutionFailures', () => {
  test('returns empty for clean output', () => {
    expect(detectExecutionFailures('Task completed successfully.')).toEqual([]);
    expect(detectExecutionFailures('対応しました')).toEqual([]);
    expect(detectExecutionFailures('')).toEqual([]);
    expect(detectExecutionFailures(null)).toEqual([]);
    expect(detectExecutionFailures(undefined)).toEqual([]);
  });

  test.each([
    {
      label: 'pnpm test lifecycle failure',
      output: `> vitest run\n\n ELIFECYCLE  Test failed. See above for more details.`,
      expectedPattern: 'pnpm-test-failed' as string | null,
    },
    {
      label: 'vitest startup error / config load failure',
      output: `failed to load config from C:\\path\\rapitas-frontend
⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
at ensureServiceIsRunning (...)`,
      expectedPattern: 'vitest-config-load-failed' as string | null,
    },
    {
      label: 'EPERM on spawn (Windows AV / fresh install)',
      output: `Error: spawn EPERM at ChildProcess.spawn`,
      expectedPattern: null as string | null,
    },
    {
      label: '"exited 1 in NNNms" pattern from agent runner',
      output: `exited 1 in 22070ms`,
      expectedPattern: 'codex-exit-1' as string | null,
    },
    {
      label: 'codex router error with non-zero exit',
      output: `2026-04-30T04:24:44.123Z ERROR codex_core::tools::router: error=Exit code: 1`,
      expectedPattern: 'codex-router-error' as string | null,
    },
    {
      label: 'node_modules missing warning',
      output: `WARN  Local package.json exists, but node_modules missing, did you mean to install?`,
      expectedPattern: 'node-modules-missing' as string | null,
    },
  ])('detects $label', ({ output, expectedPattern }) => {
    const signals = detectExecutionFailures(output);
    expect(signals.length).toBeGreaterThan(0);
    if (expectedPattern) {
      expect(signals.some((s) => s.pattern === expectedPattern)).toBe(true);
    }
  });

  test('does NOT match plain prose mentioning "error" / "test failed"', () => {
    expect(detectExecutionFailures('I noticed an error in the code that I fixed')).toEqual([]);
    expect(
      detectExecutionFailures('The test failed initially but I rewrote it and it now passes'),
    ).toEqual([]);
    expect(detectExecutionFailures('No errors detected in the build output')).toEqual([]);
  });

  test('truncates excerpt around the match', () => {
    const padding = 'lorem ipsum '.repeat(50);
    const output = `${padding}ELIFECYCLE  Test failed.${padding}`;
    const signals = detectExecutionFailures(output);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].excerpt.length).toBeLessThan(200);
    expect(signals[0].excerpt).toContain('ELIFECYCLE');
  });

  test('returns multiple signals when multiple patterns match', () => {
    const output = `
       failed to load config from /path/rapitas-frontend/vitest.config.ts
       Startup Error ⎯⎯⎯⎯⎯
        at ensureServiceIsRunning
       exited 1 in 22070ms
       ELIFECYCLE  Test failed.
    `;
    const signals = detectExecutionFailures(output);
    expect(signals.length).toBeGreaterThanOrEqual(3);
  });
});

describe('hasExecutionFailures', () => {
  test('returns true when any pattern matches', () => {
    expect(hasExecutionFailures('ELIFECYCLE  Test failed.')).toBe(true);
    expect(hasExecutionFailures('exited 1 in 100ms')).toBe(true);
  });

  test('returns false for clean output', () => {
    expect(hasExecutionFailures('All tests passed')).toBe(false);
    expect(hasExecutionFailures('')).toBe(false);
  });
});
