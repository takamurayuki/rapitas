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
 * Not responsible for running tests (Phase 2), committing, or the retry loop.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, extname, join, relative, resolve } from 'path';

/** Code extensions worth linting / typechecking. */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Per-command timeout (ms). Lint/typecheck on a large project can be slow. */
const CMD_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_CHARS = 16 * 1024 * 1024;
/** Cap how much raw output we keep in the report. */
const MAX_DETAIL_CHARS = 2_000;

export interface VerificationCheck {
  name: 'lint' | 'typecheck';
  /** Whether the check was applicable and actually executed. */
  ran: boolean;
  /** True when the check passed (no new failures in the changed files). */
  ok: boolean;
  /** Number of failures attributed to the agent's changes. */
  errorCount: number;
  /** Truncated, human-readable evidence (real command output). */
  details: string;
}

export interface VerificationResult {
  /** True when every check that ran passed. */
  ok: boolean;
  /** Code files the agent added/modified (repo-relative). */
  changedFiles: string[];
  checks: VerificationCheck[];
  /** One-line human summary. */
  summary: string;
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
function runCmd(command: string, cwd: string): Promise<CmdResult> {
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
    }, CMD_TIMEOUT_MS);
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
 * Lists the agent's added/modified code files (repo-relative), excluding
 * deletions and non-code files.
 */
async function getChangedCodeFiles(workdir: string): Promise<string[]> {
  // ACMR = added/copied/modified/renamed — excludes deletions (nothing to lint).
  const tracked = await git(workdir, 'diff HEAD --name-only --diff-filter=ACMR');
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

/** Lints a project's changed files; gates on error (not warning) count. */
async function lintProject(
  projectRoot: string,
  workdir: string,
  relFiles: string[],
): Promise<VerificationCheck | null> {
  const bin = resolveBin(projectRoot, workdir, 'eslint');
  if (!bin) return null;
  // Pass files relative to the project root.
  const args = relFiles
    .map((f) => `"${relative(projectRoot, join(workdir, f)).replace(/\\/g, '/')}"`)
    .join(' ');
  const res = await runCmd(`"${bin}" --format json ${args}`, projectRoot);
  const parsed = parseEslintErrorCount(res.stdout);
  if (!parsed.ok) return null; // eslint crashed / config error — treat as not run
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
  if (!bin) return null;
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

/** Merges per-project checks of the same kind into one aggregate check. */
function mergeChecks(name: 'lint' | 'typecheck', parts: VerificationCheck[]): VerificationCheck {
  const ran = parts.filter((p) => p.ran);
  if (ran.length === 0) {
    return { name, ran: false, ok: true, errorCount: 0, details: `${name}: not applicable` };
  }
  const errorCount = ran.reduce((s, p) => s + p.errorCount, 0);
  const details = ran
    .filter((p) => !p.ok)
    .map((p) => p.details)
    .join('\n\n')
    .slice(0, MAX_DETAIL_CHARS);
  return { name, ran: true, ok: errorCount === 0, errorCount, details: details || `${name}: ok` };
}

/**
 * Runs automated lint + typecheck verification on an agent's worktree.
 *
 * @param workdir - The agent's git worktree path / エージェントの worktree パス
 * @returns Structured verification result / 構造化された検証結果
 */
export async function runAutomatedVerification(workdir: string): Promise<VerificationResult> {
  const changedFiles = await getChangedCodeFiles(workdir);
  if (changedFiles.length === 0) {
    return { ok: true, changedFiles: [], checks: [], summary: '自動検証: 対象のコード変更なし' };
  }

  const groups = groupByProjectRoot(workdir, changedFiles);
  const lintParts: VerificationCheck[] = [];
  const typeParts: VerificationCheck[] = [];
  for (const [projectRoot, relFiles] of groups) {
    const [lint, type] = await Promise.all([
      lintProject(projectRoot, workdir, relFiles),
      typecheckProject(projectRoot, workdir, relFiles),
    ]);
    if (lint) lintParts.push(lint);
    if (type) typeParts.push(type);
  }

  const checks = [mergeChecks('lint', lintParts), mergeChecks('typecheck', typeParts)];
  const ok = checks.every((c) => c.ok);
  const summary = checks
    .map((c) => (!c.ran ? `${c.name}=skip` : c.ok ? `${c.name}=ok` : `${c.name}=NG(${c.errorCount})`))
    .join(' / ');

  return { ok, changedFiles, checks, summary: `自動検証: ${summary}` };
}

/** Renders a verification result as a Markdown block for verify.md / reports. */
export function renderVerificationMarkdown(result: VerificationResult): string {
  const lines = [
    '## 自動検証結果（lint / 型チェック）',
    '',
    `- 判定: ${result.ok ? '✅ 合格' : '❌ 失敗（新規エラー検出）'}`,
  ];
  for (const c of result.checks) {
    const status = !c.ran ? '対象外' : c.ok ? '✅ OK' : `❌ ${c.errorCount}件`;
    lines.push(`- ${c.name}: ${status}`);
    if (c.ran && !c.ok) lines.push('', '```', c.details, '```');
  }
  lines.push('', `対象変更ファイル: ${result.changedFiles.length}件`);
  return lines.join('\n');
}
