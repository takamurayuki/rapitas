/**
 * verification-test-measurement.flags.test
 *
 * 2026-11-28: the scoped test command the verifier runs carries
 * `--max-concurrency=2`. The selected-file check dropped only `--isolate`, so
 * the flag counted as a selected file that never appeared in the report, and
 * every real self-verification job came back with no passed count. Verifiers
 * then could not claim success (task 1572 bounced on it). Runner flags are not
 * files; a selected file that is really missing still voids the count.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { runMeasuredTest } from './verification-test-measurement';

const TEST_SOURCE =
  "import { test, expect } from 'bun:test';\ntest('実測', () => expect(1).toBe(1));";

async function measure(dir: string, command: string) {
  return runMeasuredTest(command, dir, 20000, async (cmd, cwd) => {
    const args = cmd
      .match(/"[^"]*"|[^\s]+/g)!
      .slice(1)
      .map((s) => s.replace(/"/g, ''));
    const res = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
    return { code: res.status ?? 1, stdout: res.stdout, stderr: res.stderr };
  });
}

describe('runMeasuredTest — runner flags are not selected files', () => {
  test('a command with --max-concurrency still yields the passed count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rapitas-measure-flags-'));
    try {
      writeFileSync(join(dir, 'a.test.ts'), TEST_SOURCE);
      writeFileSync(join(dir, 'b.test.ts'), TEST_SOURCE);
      const measured = await measure(
        dir,
        'bun test --isolate --max-concurrency=2 "./a.test.ts" "./b.test.ts"',
      );
      expect(measured.res.code).toBe(0);
      expect(measured.passedCount).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  test('a selected file that is missing from the report still voids the count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rapitas-measure-flags-'));
    try {
      writeFileSync(join(dir, 'a.test.ts'), TEST_SOURCE);
      const measured = await measure(
        dir,
        'bun test --isolate --max-concurrency=2 "./a.test.ts" "./missing.test.ts"',
      );
      expect(measured.passedCount).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
