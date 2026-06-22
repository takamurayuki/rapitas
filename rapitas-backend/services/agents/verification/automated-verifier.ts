/**
 * automated-verifier
 *
 * Runs REAL lint + typecheck against an agent's worktree changes and reports
 * whether the agent INTRODUCED any failures. Replaces prose-only verify.md
 * claims with actual command output. Scoped to the agent's changed files (and,
 * for tsc, errors are filtered to those files) so pre-existing problems in the
 * project don't cause false gating. Monorepo-aware: groups changed files by the
 * nearest package.json and runs the tooling per project root.
 *
 * All subprocesses run ASYNChronously (spawn) — never execSync — so a slow
 * tsc/eslint can't block the single-threaded backend event loop.
 *
 * Optionally also runs the project's test suite (opt-in via RAPITAS_VERIFY_TESTS)
 * so the gate covers runtime breakage, not just lint/types. Not responsible for
 * committing or the retry loop.
 */
import { spawn } from 'child_process';
import os from 'os';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, extname, join, relative, resolve } from 'path';
import { buildScopedTestCommands, findRelatedTestFiles, TEST_FILE_RE } from './related-tests';
import { triageTestFailures } from './test-triage';
import { parsePlanFiles, evaluateScopeCheck } from './scope-check';

/** Code extensions worth linting / typechecking. */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Per-command timeout (ms). Lint/typecheck on a large project can be slow. */
const CMD_TIMEOUT_MS = 180_000;
/** Test suites routinely run much longer than lint/tsc. */
const TEST_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 16 * 1024 * 1024;
/** Cap how much raw output we keep in the report. */
const MAX_DETAIL_CHARS = 2_000;

export interface VerificationCheck {
  name: 'lint' | 'typecheck' | 'test' | 'scope' | 'coverage';
  /** Whether the check was applicable and actually executed. */
  ran: boolean;
  /** True when the check passed (no new failures in the changed files). */
  ok: boolean;
  /** Number of failures attributed to the agent's changes. */
  errorCount: number;
  /** Truncated, human-readable evidence (real command output). */
  details: string;
  /**
   * True when the check SHOULD have run (tooling configured) but could not
   * execute — the gate fails closed instead of silently treating it as passed.
   */
  unverifiable?: boolean;
  /**
   * Test files that failed before the agent's changes (pre-existing failures).
   * Only set on 'test' checks when triage detected at least one pre-existing failure.
   * These are excluded from errorCount/ok so they don't false-block the gate.
   */
  preExistingFailures?: string[];
}

export interface VerificationResult {
  /** True when every check that ran passed. */
  ok: boolean;
  /** Code files the agent added/modified (repo-relative). */
  changedFiles: string[];
  checks: VerificationCheck[];
  /** One-line human summary. */
  summary: string;
  /**
   * True when at least one check was unverifiable (configured tooling could not
   * run). Distinct from a normal failure: self-repair retries cannot fix it.
   */
  unverifiable?: boolean;
}

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a shell command asynchronously, capturing output. Never rejects — a
 * non-zero exit (lint/tsc found problems) is a normal, expected outcome.
 */
function runCmd(
  command: string,
  cwd: string,
  timeoutMs: number = CMD_TIMEOUT_MS,
): Promise<CmdResult> {
  return new Promise((resolveP) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(124); // timeout
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += d.toString();
    });
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code ?? 0));
  });
}

/** Runs a git command in a directory, returning stdout (or '' on failure). */
async function git(cwd: string, args: string): Promise<string> {
  const res = await runCmd(`git ${args}`, cwd);
  return res.code === 0 ? res.stdout : '';
}

/**
 * Resolves a runnable local CLI binary in a project's node_modules/.bin, or
 * null. Tries the shim variants different package managers create on Windows
 * (npm → .cmd, bun → .exe) so verification works regardless of how deps were
 * installed.
 */
function resolveBin(projectRoot: string, workdir: string, name: string): string | null {
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

/**
 * Resolve the fork-point this worktree branched from, so changed-file lists
 * include commits the agent made mid-run. A plain `git diff HEAD` only shows
 * UNCOMMITTED work, so once the agent commits (workflow verify phase commits
 * before this gate runs) the change set reads as empty — the scope check sees
 * nothing and lint runs on nothing, a silent false pass. Mirrors getDiff's
 * base order (develop → main → master); falls back to HEAD when none exists.
 *
 * @param workdir - Worktree directory. / ワークツリーのディレクトリ
 * @returns A diffable base ref (merge-base commit or 'HEAD'). / 差分基準のref
 */
export async function diffBaseRef(workdir: string): Promise<string> {
  for (const candidate of ['develop', 'main', 'master']) {
    const base = (await git(workdir, `merge-base HEAD ${candidate}`)).trim();
    if (base) return base;
  }
  return 'HEAD';
}

/**
 * Lists EVERY changed path in the worktree (any file type, including
 * deletions) for the plan-scope check — out-of-plan deletions and non-code
 * edits are scope violations too.
 */
async function getAllChangedFiles(workdir: string): Promise<string[]> {
  const base = await diffBaseRef(workdir);
  const tracked = await git(workdir, `diff ${base} --name-only --diff-filter=ACMRD`);
  const untracked = await git(workdir, 'ls-files --others --exclude-standard');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of `${tracked}\n${untracked}`.split('\n')) {
    const f = line.trim();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}

/**
 * Lists the agent's added/modified code files (repo-relative), excluding
 * deletions and non-code files.
 */
async function getChangedCodeFiles(workdir: string): Promise<string[]> {
  // ACMR = added/copied/modified/renamed — excludes deletions (nothing to lint).
  // Base = fork-point (not HEAD) so files in the agent's mid-run commits are linted.
  const base = await diffBaseRef(workdir);
  const tracked = await git(workdir, `diff ${base} --name-only --diff-filter=ACMR`);
  const untracked = await git(workdir, 'ls-files --others --exclude-standard');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of `${tracked}\n${untracked}`.split('\n')) {
    const f = line.trim();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    if (!CODE_EXTENSIONS.has(extname(f).toLowerCase())) continue;
    if (!existsSync(join(workdir, f))) continue;
    out.push(f);
  }
  return out;
}

/** Nearest ancestor directory (within workdir) that holds a package.json. */
function projectRootFor(workdir: string, file: string): string {
  const root = resolve(workdir);
  let dir = dirname(resolve(join(workdir, file)));
  while (dir.startsWith(root)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return root;
}

/** Groups changed files by their owning project root (for monorepos). */
function groupByProjectRoot(workdir: string, files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const rootDir = projectRootFor(workdir, f);
    const list = groups.get(rootDir) ?? [];
    list.push(f);
    groups.set(rootDir, list);
  }
  return groups;
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

/**
 * Extracts tsc error file paths (relative to the project root) from
 * `tsc --noEmit --pretty false` output. Pure — the verifier's testable core.
 */
export function parseTscErrorFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split('\n')) {
    // e.g. "src/foo.ts(12,5): error TS2322: ..."
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+/);
    if (m) files.push(m[1].trim().replace(/\\/g, '/'));
  }
  return files;
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
function unverifiableCheck(
  name: 'lint' | 'typecheck' | 'test',
  details: string,
): VerificationCheck {
  return { name, ran: false, ok: false, errorCount: 0, details, unverifiable: true };
}

/** Lints a project's changed files; gates on error (not warning) count. */
async function lintProject(
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
  const args = relFiles
    .map((f) => `"${relative(projectRoot, join(workdir, f)).replace(/\\/g, '/')}"`)
    .join(' ');
  const res = await runCmd(`"${bin}" --format json ${args}`, projectRoot);
  const parsed = parseEslintErrorCount(res.stdout);
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
    ok: parsed.errorCount === 0,
    errorCount: parsed.errorCount,
    details:
      parsed.errorCount === 0
        ? 'eslint: 0 errors'
        : (res.stderr || res.stdout).slice(0, MAX_DETAIL_CHARS),
  };
}

/** Default-ON kill switch for the scoped (changed-files-only) typecheck. */
function scopedTscEnabled(): boolean {
  const v = (process.env.RAPITAS_VERIFY_SCOPED_TSC ?? '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 * TS error codes that mean the type ENVIRONMENT is missing (module / type-defs /
 * node-or-bun global resolution failures), not that the agent's code is wrong.
 * When the scoped (narrow-include) typecheck surfaces ANY of these, the narrowed
 * program dropped an ambient/global provider — the scope is unreliable, so we
 * re-run a FULL typecheck. Falling back is always correctness-safe: a genuine
 * "cannot find module" bug is re-reported by the full run too, so the worst case
 * is slower, never a wrong verdict.
 */
const ENV_FAILURE_TS_CODES = new Set(['TS2307', 'TS2688', 'TS2591', 'TS2580']);

/** True when scoped tsc output carries an env-resolution failure (→ use full). */
function looksLikeBrokenTypeEnv(output: string): boolean {
  for (const m of output.matchAll(/error (TS\d+)/g)) {
    if (ENV_FAILURE_TS_CODES.has(m[1]!)) return true;
  }
  return false;
}

/**
 * Run tsc over ONLY the changed files (+ their transitive imports) instead of the
 * whole project, via a temp tsconfig that extends the project's real config (so
 * strictness/paths/lib are identical). `types: ['bun']` re-supplies the global
 * type environment that the full `include` provides implicitly — without it a
 * narrow include loses node/bun globals. Measured ~6× faster (13.8s → 2.3s on
 * this backend) with an IDENTICAL changed-file error set (verified positive AND
 * negative). Returns the raw tsc output, or null when scoping isn't applicable.
 *
 * @param bin - Resolved tsc binary. / 解決済みtscバイナリ
 * @param projectRoot - Project whose tsconfig.json to extend. / 対象プロジェクト
 * @param relFiles - Changed files, relative to projectRoot. / 変更ファイル(相対)
 * @returns Combined stdout+stderr, or null to fall back to full. / 出力 or null
 */
async function runScopedTypecheck(
  bin: string,
  projectRoot: string,
  relFiles: string[],
): Promise<string | null> {
  // `types: ['bun']` only fits a bun project; for others the global env differs,
  // so skip scoping and let the caller run full (conservative until validated).
  if (!existsSync(join(projectRoot, 'node_modules', 'bun-types'))) return null;

  const cfgPath = join(projectRoot, `.rapitas-verify-scoped-${process.pid}.tsconfig.json`);
  const cfg = {
    extends: './tsconfig.json',
    // incremental:false avoids littering a .tsbuildinfo per run (no speedup for
    // --noEmit anyway, measured).
    compilerOptions: { types: ['bun'], incremental: false },
    include: relFiles.map((f) => f.replace(/\\/g, '/')),
  };
  try {
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const res = await runCmd(`"${bin}" -p "${cfgPath}" --noEmit --pretty false`, projectRoot);
    const out = `${res.stdout}\n${res.stderr}`;
    // Broken scope (dropped globals) → signal a full re-run.
    return looksLikeBrokenTypeEnv(out) ? null : out;
  } catch {
    return null; // any failure → fall back to full
  } finally {
    try {
      unlinkSync(cfgPath);
    } catch {
      /* best-effort */
    }
  }
}

/** Typechecks a project; gates on tsc errors located in the changed files. */
async function typecheckProject(
  projectRoot: string,
  workdir: string,
  relFiles: string[],
): Promise<VerificationCheck | null> {
  if (!existsSync(join(projectRoot, 'tsconfig.json'))) return null;
  const bin = resolveBin(projectRoot, workdir, 'tsc');
  if (!bin) {
    // tsconfig.json present but tsc unresolved → broken setup, fail closed.
    return unverifiableCheck(
      'typecheck',
      'tsconfig.json is present but the tsc binary could not be resolved (worktree node_modules missing?).',
    );
  }
  // Fast path: typecheck only the changed files. Falls through to a FULL run when
  // scoping doesn't apply or looks unreliable — same verdict, just slower.
  const scopedOut = scopedTscEnabled()
    ? await runScopedTypecheck(bin, projectRoot, relFiles)
    : null;
  let combined: string;
  if (scopedOut !== null) {
    combined = scopedOut;
  } else {
    const res = await runCmd(`"${bin}" --noEmit --pretty false`, projectRoot);
    combined = `${res.stdout}\n${res.stderr}`;
  }
  const errorFiles = parseTscErrorFiles(combined);
  // Only count errors located in the files the agent changed (avoids gating on
  // pre-existing type errors elsewhere in the project).
  const changedRel = new Set(
    relFiles.map((f) => relative(projectRoot, join(workdir, f)).replace(/\\/g, '/')),
  );
  const offending = errorFiles.filter((f) => changedRel.has(f));
  const errorCount = offending.length;
  return {
    name: 'typecheck',
    ran: true,
    ok: errorCount === 0,
    errorCount,
    details:
      errorCount === 0
        ? 'tsc --noEmit: no new errors in changed files'
        : `tsc errors in changed files:\n${offending.slice(0, 40).join('\n')}`.slice(
            0,
            MAX_DETAIL_CHARS,
          ),
  };
}

/**
 * Runs the project's tests, SCOPED to the agent's changed test files PLUS the
 * tests related to its changed sources (see related-tests.ts) — so the gate
 * catches "changed foo.ts, broke foo.test.ts" without gating on pre-existing
 * red tests or live-env collisions. Returns null when tests are disabled
 * (RAPITAS_VERIFY_TESTS=0), there's no `test` script, or nothing is in scope.
 */
async function testProject(
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

/** Merges per-project checks of the same kind into one aggregate check. */
function mergeChecks(
  name: 'lint' | 'typecheck' | 'test',
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
  return {
    name,
    ran: ran.length > 0,
    ok,
    errorCount,
    details: details || `${name}: ok`,
    unverifiable: unverifiable.length > 0 || undefined,
    preExistingFailures: allPreExisting.length > 0 ? allPreExisting : undefined,
  };
}

/** Files that don't need a paired test (declarations / config / stories). */
const COVERAGE_EXEMPT_RE = /(\.d\.ts$|\.config\.[cm]?[jt]s$|\.stories\.[jt]sx?$)/i;

/**
 * OPT-IN gate (RAPITAS_REQUIRE_TESTS=1): a substantive source change must ship
 * with an added/changed test file. Off by default — enabling it without tuning
 * would block legitimate test-free changes (docs/config/UI tweaks). Deterministic
 * (runs on the changed-file list, zero cost), per the "deterministic checks
 * first" practice. Returns null when disabled or no source needs a test.
 *
 * @param changedCodeFiles - Added/modified code files. / 変更コードファイル
 * @returns A coverage check, or null when not applicable. / 判定 or null
 */
export function coverageCheck(changedCodeFiles: string[]): VerificationCheck | null {
  const raw = (process.env.RAPITAS_REQUIRE_TESTS || '').trim().toLowerCase();
  if (raw !== '1' && raw !== 'true' && raw !== 'on') return null;

  const tests = changedCodeFiles.filter((f) => TEST_FILE_RE.test(f));
  const sources = changedCodeFiles.filter(
    (f) => !TEST_FILE_RE.test(f) && !COVERAGE_EXEMPT_RE.test(f),
  );
  if (sources.length === 0) return null; // nothing that needs a test
  const ok = tests.length > 0;
  return {
    name: 'coverage',
    ran: true,
    ok,
    errorCount: ok ? 0 : 1,
    details: ok
      ? `coverage: ${tests.length} test file(s) changed alongside source`
      : `ソース変更にテストが伴っていません（テストの追加/更新が必要）:\n${sources
          .slice(0, 40)
          .join('\n')}`.slice(0, MAX_DETAIL_CHARS),
  };
}

/** Optional inputs for {@link runAutomatedVerification}. */
export interface VerificationOptions {
  /**
   * plan.md content; when provided (and it lists parseable paths) the gate also
   * fails on out-of-plan file changes. Omit in plan-less (lightweight) mode.
   */
  planContent?: string | null;
}

/**
 * Runs automated lint + typecheck + scoped-test (+ plan-scope) verification on
 * an agent's worktree.
 *
 * @param workdir - The agent's git worktree path / エージェントの worktree パス
 * @param options - Optional plan content for the scope check / scope判定用plan
 * @returns Structured verification result / 構造化された検証結果
 */
export async function runAutomatedVerification(
  workdir: string,
  options: VerificationOptions = {},
): Promise<VerificationResult> {
  const changedFiles = await getChangedCodeFiles(workdir);

  // Plan-scope check runs over the FULL diff (not just code files): an
  // out-of-plan doc/config/deletion is a violation too.
  let scopeCheck: VerificationCheck | null = null;
  if (options.planContent) {
    const planFiles = parsePlanFiles(options.planContent);
    const allChanged = await getAllChangedFiles(workdir);
    scopeCheck = evaluateScopeCheck(allChanged, planFiles);
  }

  if (changedFiles.length === 0 && (!scopeCheck || scopeCheck.ok)) {
    return {
      ok: true,
      changedFiles: [],
      checks: scopeCheck ? [scopeCheck] : [],
      summary: '自動検証: 対象のコード変更なし',
      unverifiable: false,
    };
  }

  const groups = groupByProjectRoot(workdir, changedFiles);
  const lintParts: VerificationCheck[] = [];
  const typeParts: VerificationCheck[] = [];
  const testParts: VerificationCheck[] = [];
  for (const [projectRoot, relFiles] of groups) {
    const [lint, type, test] = await Promise.all([
      lintProject(projectRoot, workdir, relFiles),
      typecheckProject(projectRoot, workdir, relFiles),
      testProject(projectRoot, workdir, relFiles),
    ]);
    if (lint) lintParts.push(lint);
    if (type) typeParts.push(type);
    if (test) testParts.push(test);
  }

  const coverage = coverageCheck(changedFiles);
  const checks = [
    mergeChecks('lint', lintParts),
    mergeChecks('typecheck', typeParts),
    mergeChecks('test', testParts),
    ...(scopeCheck ? [scopeCheck] : []),
    ...(coverage ? [coverage] : []),
  ];
  const unverifiable = checks.some((c) => c.unverifiable);
  // Scope is ADVISORY, not a hard gate. A plan-scope deviation while lint +
  // typecheck + test are all green means the agent made valid, working changes
  // that merely touch a file the plan didn't list precisely (e.g. a refactor's
  // related caller). Hard-blocking on it stranded legitimately-complete tasks and
  // churned them forever (observed #298: lint=ok/typecheck=ok/test=ok/scope=NG(1)
  // → blocked, re-run, blocked…). Gate on the CORRECTNESS checks only; scope stays
  // in the summary for visibility, and adversarial-review + PR review still catch
  // genuine scope sprawl.
  const ok = checks.filter((c) => c.name !== 'scope').every((c) => c.ok);
  const summary = checks
    .map((c) =>
      c.unverifiable
        ? `${c.name}=UNVERIFIED`
        : !c.ran
          ? `${c.name}=skip`
          : c.ok
            ? `${c.name}=ok`
            : `${c.name}=NG(${c.errorCount})`,
    )
    .join(' / ');

  return { ok, changedFiles, checks, summary: `自動検証: ${summary}`, unverifiable };
}

// NOTE: Rendering moved to verification-report.ts (file-size split); re-exported
// here so existing importers keep working.
export { renderVerificationMarkdown } from './verification-report';
