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
import { existsSync } from 'fs';
import { dirname, extname, join, relative, resolve } from 'path';
import { buildScopedTestCommands, TEST_FILE_RE } from './related-tests';
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
async function diffBaseRef(workdir: string): Promise<string> {
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
  const res = await runCmd(`"${bin}" --noEmit --pretty false`, projectRoot);
  const errorFiles = parseTscErrorFiles(`${res.stdout}\n${res.stderr}`);
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
  // Run each command in its OWN process (bun: one per file) so mock.module
  // state from one test file cannot leak into the next and cause false
  // failures. Aggregate: any failing command fails the check.
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
  return {
    name,
    ran: ran.length > 0,
    ok,
    errorCount,
    details: details || `${name}: ok`,
    unverifiable: unverifiable.length > 0 || undefined,
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
  const ok = checks.every((c) => c.ok);
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
