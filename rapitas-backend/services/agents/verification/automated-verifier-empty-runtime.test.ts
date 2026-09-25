import { test, expect, mock } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { VerificationCheck } from './automated-verifier';

// Task 1059's schema-change gate reads Task.forbiddenChangeOverride whenever a
// taskId is passed — mock it out so this test never makes a real DB round trip.
mock.module('../../../config/database', () => ({
  prisma: { task: { findUnique: () => Promise.resolve(null) } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

let result: VerificationCheck | null = null;
const runtime = mock(async () => result);
mock.module('./runtime-verification-stage', () => ({ runRuntimeVerificationStage: runtime }));
const { runAutomatedVerification } = await import('./automated-verifier');

test('an empty diff still runs configured runtime verification and preserves its verdict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'empty-runtime-'));
  try {
    execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
    for (const [verdict, expectedThreeWay] of [
      [null, 'pass'],
      [{ name: 'runtime', ran: true, ok: true, errorCount: 0, details: 'browser passed' }, 'pass'],
      [
        {
          name: 'runtime',
          ran: false,
          ok: false,
          unverifiable: true,
          errorCount: 0,
          details: 'browser unavailable',
        },
        'fail',
      ],
      [{ name: 'runtime', ran: true, ok: false, errorCount: 1, details: 'HTTP 500' }, 'fail'],
      // task 1099: a check can be ok but attribution-indeterminate — the
      // three-way verdict must surface 'unknown', distinct from a hard 'fail'.
      [
        {
          name: 'runtime',
          ran: true,
          ok: true,
          errorCount: 0,
          details: 'baseline comparison inconclusive',
          indeterminate: true,
        },
        'unknown',
      ],
    ] as Array<[VerificationCheck | null, 'pass' | 'fail' | 'unknown']>) {
      result = verdict;
      runtime.mockClear();
      const actual = await runAutomatedVerification(root, { taskId: 906 });
      expect(runtime).toHaveBeenCalledWith(root, 906);
      expect(actual.changedFiles).toEqual([]);
      expect(actual.ok).toBe(verdict?.ok ?? true);
      expect(actual.unverifiable).toBe(verdict?.unverifiable ?? false);
      expect(actual.checks.filter((c) => c.name === 'runtime')).toEqual(verdict ? [verdict] : []);
      expect(actual.verdict).toBe(expectedThreeWay);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
