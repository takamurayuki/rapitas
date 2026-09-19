/**
 * red-state-check.test
 *
 * redStateCheck does real git worktree + subprocess work (same class of
 * behavior as automated-verifier.diff-base-ref.test.ts), so it is exercised
 * against a throwaway real repo rather than mocked — a mock of `git worktree
 * add`/`bun test` would just re-assert the mock, not prove the check catches
 * a test that doesn't genuinely test the new behavior.
 *
 * maybeRunRedStateCheck's gating (skip when coverage is absent/failed or no
 * test file changed) is pure and cheap, so those paths are tested directly
 * without touching git at all.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { redStateCheck, maybeRunRedStateCheck } from './red-state-check';
import type { VerificationCheck } from './automated-verifier';

/** True if no `redcheck-*` scratch worktree dir remains under `repoDir/.worktrees`. */
function noScratchWorktreeLeftIn(repoDir: string): boolean {
  const dir = join(repoDir, '.worktrees');
  if (!existsSync(dir)) return true;
  return !readdirSync(dir).some((name) => name.startsWith('redcheck-'));
}

// Two real `bun test` subprocess runs plus a `git worktree add`/`remove` per
// test — slower than a pure-function test, same budget as the diff-base-ref
// suite's real-git tests.
const RED_STATE_TEST_TIMEOUT_MS = 60_000;

describe('maybeRunRedStateCheck — gating (no git touched)', () => {
  const failedCoverage: VerificationCheck = {
    name: 'coverage',
    ran: true,
    ok: false,
    errorCount: 1,
    details: 'no test file',
  };
  // ok=true here is an inconsistent fixture (coverageCheck would never report
  // ok without a matching test file) — deliberately checking that this
  // function re-derives testFiles itself rather than trusting coverage.ok alone.
  const passedCoverage: VerificationCheck = {
    name: 'coverage',
    ran: true,
    ok: true,
    errorCount: 0,
    details: '',
  };

  test.each([
    ['coverage is null (requirement disabled)', null, ['add.test.ts']],
    ['coverage failed (no test file at all)', failedCoverage, ['add.ts']],
    ['coverage passed but no changed file matches TEST_FILE_RE', passedCoverage, ['add.ts']],
  ] as const)('returns null when %s', async (_label, coverage, changedFiles) => {
    const result = await maybeRunRedStateCheck('/does/not/matter', [...changedFiles], coverage);
    expect(result).toBeNull();
  });
});

describe('redStateCheck — real git worktree + bun test', () => {
  let repoDir: string;
  let baseRef: string;

  function run(cmd: string): string {
    return execSync(cmd, { cwd: repoDir }).toString().trim();
  }

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'redstate-test-'));
    run('git init -q');
    run('git config user.email "test@example.com"');
    run('git config user.name "Test"');

    // BASE state: a deliberately wrong implementation (what "before the fix" looks like).
    writeFileSync(
      join(repoDir, 'add.ts'),
      'export function add(a: number, b: number): number {\n  return a - b;\n}\n',
    );
    run('git add add.ts');
    run('git commit -q -m "base: add (buggy)"');
    baseRef = run('git rev-parse HEAD');

    // Uncommitted "implementer" changes on top: fix the bug (only in the
    // working tree — redStateCheck must work from uncommitted state).
    writeFileSync(
      join(repoDir, 'add.ts'),
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    );
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  test(
    'confirms genuine RED: a test that fails against the base implementation',
    async () => {
      writeFileSync(
        join(repoDir, 'add.test.ts'),
        "import { test, expect } from 'bun:test';\nimport { add } from './add';\ntest('adds two numbers', () => {\n  expect(add(2, 3)).toBe(5);\n});\n",
      );

      const result = await redStateCheck(repoDir, baseRef, ['add.test.ts']);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('red-state');
      expect(result?.ran).toBe(true);
      expect(result?.ok).toBe(true);
      // The scratch worktree must be cleaned up, not left behind.
      expect(noScratchWorktreeLeftIn(repoDir)).toBe(true);
    },
    RED_STATE_TEST_TIMEOUT_MS,
  );

  test(
    'fails the gate when the test still passes without the fix',
    async () => {
      // Doesn't actually exercise add()'s new behavior — passes identically
      // against the base (buggy) implementation.
      writeFileSync(
        join(repoDir, 'add.test.ts'),
        "import { test, expect } from 'bun:test';\ntest('placeholder', () => {\n  expect(true).toBe(true);\n});\n",
      );

      const result = await redStateCheck(repoDir, baseRef, ['add.test.ts']);

      expect(result).not.toBeNull();
      expect(result?.ok).toBe(false);
      expect(result?.errorCount).toBeGreaterThan(0);
      expect(noScratchWorktreeLeftIn(repoDir)).toBe(true);
    },
    RED_STATE_TEST_TIMEOUT_MS,
  );

  test(
    'fails open (returns null) when baseRef cannot be resolved',
    async () => {
      writeFileSync(
        join(repoDir, 'add.test.ts'),
        "import { test, expect } from 'bun:test';\ntest('placeholder', () => {\n  expect(true).toBe(true);\n});\n",
      );

      const result = await redStateCheck(repoDir, '0000000000000000000000000000000000000000', [
        'add.test.ts',
      ]);

      expect(result).toBeNull();
    },
    RED_STATE_TEST_TIMEOUT_MS,
  );

  test(
    'returns null with no testFiles (nothing to check)',
    async () => {
      const result = await redStateCheck(repoDir, baseRef, []);
      expect(result).toBeNull();
    },
    RED_STATE_TEST_TIMEOUT_MS,
  );
});
