/**
 * verifier-test-check
 *
 * Scoped test-suite verification check (scoped command construction via
 * related-tests plus pre-existing-failure triage). Not responsible for
 * lint/typecheck/format checks. Extracted from automated-verifier.ts
 * (file-size split).
 */
import { join, relative } from 'path';
import { buildScopedTestCommands, findRelatedTestFiles, TEST_FILE_RE } from './related-tests';
import { triageTestFailures } from './test-triage';
import { MAX_DETAIL_CHARS, runCmd, TEST_TIMEOUT_MS } from './verifier-exec';
import type { VerificationCheck } from './verification-types';

/**
 * Runs the project's tests, SCOPED to the agent's changed test files PLUS the
 * tests related to its changed sources (see related-tests.ts) — so the gate
 * catches "changed foo.ts, broke foo.test.ts" without gating on pre-existing
 * red tests or live-env collisions. Returns null when tests are disabled
 * (RAPITAS_VERIFY_TESTS=0), there's no `test` script, or nothing is in scope.
 */
export async function testProject(
  projectRoot: string,
  workdir: string,
  relFiles: string[],
): Promise<VerificationCheck | null> {
  const commands = buildScopedTestCommands(projectRoot, workdir, relFiles);
  if (!commands || commands.length === 0) return null;
  // Run each command (bun: one `--isolate` command covering all files) so each
  // file runs in its own module registry; mock.module state cannot leak across
  // files. Aggregate: any failing command fails the check.
  const failures: string[] = [];
  for (const command of commands) {
    const res = await runCmd(command, projectRoot, TEST_TIMEOUT_MS);
    if (res.code === 0) continue;
    const detail =
      res.code === 124
        ? `timed out after ${TEST_TIMEOUT_MS / 1000}s`
        : (res.stdout || res.stderr).slice(-MAX_DETAIL_CHARS);
    failures.push(`${command} failed:\n${detail}`);
  }
  const ok = failures.length === 0;
  // When tests fail, triage pre-existing vs. new failures so the gate doesn't
  // block on tests that were already red before this change (RAPITAS_TEST_TRIAGE
  // defaults on; set to '0' or 'false' to disable).
  if (!ok) {
    const triageFlag = (process.env.RAPITAS_TEST_TRIAGE ?? '').trim().toLowerCase();
    const triageEnabled = triageFlag !== '0' && triageFlag !== 'false';
    if (triageEnabled) {
      const projectRel = relFiles.map((f) =>
        relative(projectRoot, join(workdir, f)).replace(/\\/g, '/'),
      );
      const changedTests = projectRel.filter((f) => TEST_FILE_RE.test(f));
      const related = findRelatedTestFiles(projectRoot, projectRel);
      const scopedFiles = [...new Set([...changedTests, ...related])];
      if (scopedFiles.length > 0) {
        const triage = await triageTestFailures(projectRoot, workdir, scopedFiles);
        if (triage !== null) {
          const { preExisting, newFailures } = triage;
          const newOk = newFailures.length === 0;
          return {
            name: 'test',
            ran: true,
            ok: newOk,
            errorCount: newFailures.length,
            details: newOk
              ? `${commands.length} test command(s): passed (${preExisting.length} pre-existing failure(s) excluded)`
              : failures.join('\n\n').slice(0, MAX_DETAIL_CHARS),
            preExistingFailures: preExisting.length > 0 ? preExisting : undefined,
          };
        }
      }
    }
  }
  return {
    name: 'test',
    ran: true,
    ok,
    errorCount: failures.length,
    details: ok
      ? `${commands.length} test command(s): passed`
      : failures.join('\n\n').slice(0, MAX_DETAIL_CHARS),
  };
}
