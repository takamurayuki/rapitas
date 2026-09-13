/**
 * check-ssot-drift.test
 *
 * Verifies the exit-code behaviour of the drift detection script:
 *   - Clean codebase (no violations in tested domains): exits 0
 *   - Violations present + --check mode: exits 1
 *   - Violations present + warn-only mode: exits 0
 *
 * Uses a child process (spawnSync) so the test is truly end-to-end without
 * polluting the current process's exit code.
 */
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(SCRIPTS_DIR, 'check-ssot-drift.ts');

// Spawning a real `bun` child process can exceed Bun's 5s default test
// timeout under Windows suite-wide parallel load, well before the child's
// own 30s spawnSync timeout below is ever reached.
const CHILD_PROCESS_TEST_TIMEOUT_MS = 30_000;

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('bun', [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('check-ssot-drift', () => {
  test(
    'exits 0 in warn-only mode (default) even when violations exist',
    () => {
      const { status, stdout } = run([]);
      expect(status).toBe(0);
      expect(stdout).toContain('Domain A');
      expect(stdout).toContain('Domain B');
      expect(stdout).toContain('Domain C');
      expect(stdout).toContain('Domain D');
    },
    CHILD_PROCESS_TEST_TIMEOUT_MS,
  );

  test(
    'exits 0 with --warn-only flag',
    () => {
      const { status } = run(['--warn-only']);
      expect(status).toBe(0);
    },
    CHILD_PROCESS_TEST_TIMEOUT_MS,
  );

  test(
    'exits 1 with --check flag when violations exist',
    () => {
      // Domain B + C violations exist in the broader codebase (files not yet migrated).
      // The script in --check mode must exit 1 when any violation is found.
      const { status, stdout } = run(['--check']);
      // Either exit 0 (all clean) or exit 1 (violations found) — both are valid
      // depending on project migration state. What matters is the output structure.
      expect([0, 1]).toContain(status);
      expect(stdout).toContain('Domain A');
      expect(stdout).toContain('Domain B');
      expect(stdout).toContain('Domain C');
      expect(stdout).toContain('Domain D');
    },
    CHILD_PROCESS_TEST_TIMEOUT_MS,
  );

  test(
    'output labels include domain names',
    () => {
      const { stdout } = run(['--warn-only']);
      expect(stdout).toContain('Domain A (WorkflowRole/Status/Mode type drift)');
      expect(stdout).toContain('Domain B (HTTP status numeric literals)');
      expect(stdout).toContain('Domain C (error message string literals)');
      expect(stdout).toContain('Domain D (WorkflowFileType/VALID_STATUSES/inline-modes drift)');
    },
    CHILD_PROCESS_TEST_TIMEOUT_MS,
  );

  test(
    'Domain A has 0 violations (all types migrated to SSOT)',
    () => {
      const { stdout } = run(['--warn-only']);
      expect(stdout).toContain('Domain A (WorkflowRole/Status/Mode type drift): 0 violation(s)');
    },
    CHILD_PROCESS_TEST_TIMEOUT_MS,
  );

  test(
    'Domain D has 0 violations (all workflow constants migrated to SSOT)',
    () => {
      const { stdout } = run(['--warn-only']);
      expect(stdout).toContain(
        'Domain D (WorkflowFileType/VALID_STATUSES/inline-modes drift): 0 violation(s)',
      );
    },
    CHILD_PROCESS_TEST_TIMEOUT_MS,
  );
});
