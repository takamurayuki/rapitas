/**
 * verifier-project-lint
 *
 * ESLint and prettier checks for one project root of the agent's changed
 * files, plus the binary resolution and fail-closed helpers they share with
 * the typecheck/test checks, and the per-kind merge of project parts. Split
 * out of automated-verifier.ts (file-size limit, task 1602); does not decide
 * the overall verdict.
 */
import { existsSync } from 'fs';
import { dirname, extname, join, relative, resolve } from 'path';
import { buildFileCommands } from './command-batches';
import { runCmd } from './verify-command-runner';
import { sumPassedCounts } from './verification-test-measurement';
import { MAX_DETAIL_CHARS, type VerificationCheck } from './verification-check-types';

/**
 * Resolves a runnable local CLI binary in a project's node_modules/.bin, or
 * null. Tries the shim variants different package managers create on Windows
 * (npm → .cmd, bun → .exe) so verification works regardless of how deps were
 * installed.
 */
export function resolveBin(projectRoot: string, workdir: string, name: string): string | null {
  const candidates =
    process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name] : [name];
  for (const root of [projectRoot, workdir]) {
    const binDir = join(root, 'node_modules', '.bin');
    for (const candidate of candidates) {
      const p = join(binDir, candidate);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Sums error (not warning) counts from `eslint --format json` output. */
export function parseEslintErrorCount(stdout: string): { ok: boolean; errorCount: number } {
  try {
    const results = JSON.parse(stdout) as Array<{ errorCount?: number }>;
    if (!Array.isArray(results)) return { ok: false, errorCount: 0 };
    const errorCount = results.reduce((sum, r) => sum + (r.errorCount ?? 0), 0);
    return { ok: true, errorCount };
  } catch {
    return { ok: false, errorCount: 0 }; // not valid JSON → eslint couldn't run
  }
}

/** ESLint config filenames that signal "this project is supposed to be linted". */
const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
];

/**
 * True when an ESLint config exists at projectRoot or any ancestor up to workdir
 * — i.e. the project is expected to lint. Flat config resolves upward, so we walk
 * up rather than checking only the immediate root.
 */
function hasEslintConfig(projectRoot: string, workdir: string): boolean {
  const top = resolve(workdir);
  let dir = resolve(projectRoot);
  for (;;) {
    if (ESLINT_CONFIG_FILES.some((f) => existsSync(join(dir, f)))) return true;
    if (dir === top) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Builds a check marking that a verification SHOULD have run (tooling configured)
 * but could not execute, so the gate must fail closed rather than silently pass.
 */
export function unverifiableCheck(
  name: 'lint' | 'typecheck' | 'test',
  details: string,
): VerificationCheck {
  return { name, ran: false, ok: false, errorCount: 0, details, unverifiable: true };
}

/** Lints a project's changed files; gates on error (not warning) count. */
export async function lintProject(
  projectRoot: string,
  workdir: string,
  relFiles: string[],
): Promise<VerificationCheck | null> {
  const configured = hasEslintConfig(projectRoot, workdir);
  const bin = resolveBin(projectRoot, workdir, 'eslint');
  if (!bin) {
    // No eslint configured anywhere → legitimately skip. Configured but the
    // binary is missing (e.g. a worktree without linked node_modules) → fail
    // closed so a broken setup can't masquerade as "passed".
    return configured
      ? unverifiableCheck(
          'lint',
          'eslint is configured but its binary could not be resolved (worktree node_modules missing?).',
        )
      : null;
  }
  // Pass files relative to the project root.
  const files = relFiles.map(
    (f) => `"${relative(projectRoot, join(workdir, f)).replace(/\\/g, '/')}"`,
  );
  const results = [];
  for (const command of buildFileCommands(`"${bin}" --format json`, files)) {
    results.push(await runCmd(command, projectRoot, { heavy: true }));
  }
  const counts = results.map((result) => parseEslintErrorCount(result.stdout));
  const parsed = {
    ok: counts.every((count) => count.ok),
    errorCount: counts.reduce((total, count) => total + count.errorCount, 0),
  };
  const res = {
    stdout: results.map((result) => result.stdout).join('\n'),
    stderr: results.map((result) => result.stderr).join('\n'),
  };
  if (!parsed.ok) {
    // eslint is present but produced no parseable JSON (config error / crash).
    // It tried and failed — that is unverifiable, not "not applicable".
    return unverifiableCheck(
      'lint',
      `eslint could not produce parseable output:\n${(res.stderr || res.stdout).slice(0, MAX_DETAIL_CHARS)}`,
    );
  }
  return {
    name: 'lint',
    ran: true,
    ok: parsed.errorCount === 0 && results.every((result) => result.code === 0),
    errorCount: parsed.errorCount,
    details:
      parsed.errorCount === 0
        ? 'eslint: 0 errors'
        : (res.stderr.trim() || res.stdout).slice(0, MAX_DETAIL_CHARS),
  };
}

/** Extensions the CI prettier steps check (backend *.ts / frontend src globs). */
const FORMAT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.md']);

/**
 * Prettier-checks a project's changed files — CI's "Check formatting" steps
 * run `prettier --check`, so an unformatted file passes the local eslint gate
 * yet still bounces the PR at CI (a whole ci_repair round for whitespace).
 * Skips silently when the project has no prettier binary (not every repo
 * formats with prettier); prettier itself respects .prettierignore.
 */
export async function formatProject(
  projectRoot: string,
  workdir: string,
  relFiles: string[],
): Promise<VerificationCheck | null> {
  const files = relFiles.filter((f) => FORMAT_EXTENSIONS.has(extname(f).toLowerCase()));
  if (files.length === 0) return null;
  const bin = resolveBin(projectRoot, workdir, 'prettier');
  if (!bin) return null;
  const args = files.map((f) => `"${relative(projectRoot, join(workdir, f)).replace(/\\/g, '/')}"`);
  const results = [];
  for (const command of buildFileCommands(`"${bin}" --check --ignore-unknown`, args)) {
    results.push(await runCmd(command, projectRoot, { heavy: true }));
  }
  const ok = results.every((result) => result.code === 0);
  const res = {
    stdout: results.map((result) => result.stdout).join('\n'),
    stderr: results.map((result) => result.stderr).join('\n'),
  };
  return {
    name: 'format',
    ran: true,
    ok,
    errorCount: ok ? 0 : Math.max(1, (res.stderr.match(/^\[warn\]/gm) ?? []).length),
    details: ok
      ? 'prettier: all changed files formatted'
      : `prettier --check に失敗（CI の formatting チェックで落ちます）。\`prettier --write\` で整形してください:\n${(res.stderr || res.stdout).slice(0, MAX_DETAIL_CHARS)}`,
  };
}

/** Merges per-project checks of the same kind into one aggregate check. Exported for tests. */
export function mergeChecks(
  name: 'lint' | 'typecheck' | 'test' | 'format',
  parts: VerificationCheck[],
): VerificationCheck {
  const unverifiable = parts.filter((p) => p.unverifiable);
  const ran = parts.filter((p) => p.ran);
  if (ran.length === 0 && unverifiable.length === 0) {
    return { name, ran: false, ok: true, errorCount: 0, details: `${name}: not applicable` };
  }
  const errorCount = ran.reduce((s, p) => s + p.errorCount, 0);
  // Any unverifiable part fails the merged check (fail closed).
  const ok = unverifiable.length === 0 && errorCount === 0;
  const details = [
    ...unverifiable.map((p) => p.details),
    ...ran.filter((p) => !p.ok).map((p) => p.details),
  ]
    .join('\n\n')
    .slice(0, MAX_DETAIL_CHARS);
  // Aggregate pre-existing failures across all project parts (only set for 'test').
  const allPreExisting = parts.flatMap((p) => p.preExistingFailures ?? []);
  const allIndeterminate = parts.flatMap((p) => p.indeterminateFailures ?? []);
  return {
    name,
    ran: ran.length > 0,
    ok,
    errorCount,
    passedCount: name === 'test' ? sumPassedCounts(parts) : undefined,
    details: details || `${name}: ok`,
    unverifiable: unverifiable.length > 0 || undefined,
    preExistingFailures: allPreExisting.length > 0 ? allPreExisting : undefined,
    indeterminate: parts.some((p) => p.indeterminate) || undefined,
    indeterminateFailures: allIndeterminate.length > 0 ? allIndeterminate : undefined,
  };
}
