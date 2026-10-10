/**
 * WorktreeCommandWrapper
 *
 * Provisions `scripts/run-checked.cjs` inside a generated project's worktree so
 * the heartbeat/exit-code wrapper every agent prompt instructs them to use is
 * actually executable there.
 * Not responsible for dependencies (dependency-installer.ts) or for deciding
 * which commands an agent runs.
 */

import { existsSync, mkdirSync, copyFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

/** Path of the wrapper inside a worktree, and the exclude entry that hides it. */
export const WRAPPER_RELATIVE_PATH = 'scripts/run-checked.cjs';

/**
 * rapitas's own copy of the wrapper. Derived from this module's location so it
 * follows the checkout rather than an absolute path baked into a config.
 */
export function defaultWrapperSource(moduleDir: string): string {
  // worktree → git-operations → orchestrator → agents → services → rapitas-backend → repo root
  return resolve(moduleDir, '../../../../../..', WRAPPER_RELATIVE_PATH);
}

/** What ensureRunCheckedWrapper did, for logging. */
export type WrapperAction = 'copied' | 'present' | 'source-missing';

/**
 * Make `node scripts/run-checked.cjs` work inside a worktree.
 *
 * NOTE: Why this exists — every implementer and verifier prompt carries
 * shellExitCodeSafetyRule, which tells the agent to run verification through
 * `node scripts/run-checked.cjs`. That script ships with rapitas and does NOT
 * exist in a generated project, so agents there ran raw commands instead. The
 * wrapper is also the only thing that prints a heartbeat line every 30s, and
 * Claude Code kills an agent after ~301 seconds with no output: a first-time
 * dependency install, a Playwright browser download or a long test run would
 * silence the agent past that limit and get it killed mid-write, which is how
 * truncated/garbled verify.md bodies were produced in the first place.
 *
 * The copy is excluded via `.git/info/exclude` rather than left untracked, so
 * an agent running `git add .` cannot commit rapitas's internal tooling into
 * the generated app's repository.
 *
 * @param worktreePath - Worktree root to provision / 対象 worktree のルート
 * @param source - Wrapper to copy; defaults to rapitas's own / コピー元（既定は rapitas 同梱）
 * @returns What was done / 実施内容
 */
export function ensureRunCheckedWrapper(worktreePath: string, source: string): WrapperAction {
  const destination = join(worktreePath, WRAPPER_RELATIVE_PATH);
  if (existsSync(destination)) return 'present';
  if (!existsSync(source)) return 'source-missing';

  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  excludeFromGit(worktreePath);
  return 'copied';
}

/**
 * Add the wrapper to the repository's local exclude list, once.
 *
 * NOTE: `.git` inside a worktree is a FILE pointing at the common directory, so
 * the exclude file is resolved through it; the entry is therefore shared by
 * every worktree of that repository, which is what we want — and it is a
 * local-only file that is never pushed.
 *
 * @param worktreePath - Worktree root / worktree のルート
 */
function excludeFromGit(worktreePath: string): void {
  const excludeFile = resolveExcludeFile(worktreePath);
  if (!excludeFile) return;

  try {
    const existing = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf8') : '';
    if (existing.split(/\r?\n/).includes(WRAPPER_RELATIVE_PATH)) return;
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    appendFileSync(
      excludeFile,
      `${prefix}# Provisioned by rapitas so agents can run verification with a heartbeat.\n${WRAPPER_RELATIVE_PATH}\n`,
      'utf8',
    );
  } catch {
    // A missing or unwritable exclude file is not worth failing the bootstrap
    // over: the wrapper still works, it is merely visible to `git status`.
  }
}

/**
 * Locate `info/exclude` for a worktree, following the `.git` file when present.
 *
 * @param worktreePath - Worktree root / worktree のルート
 * @returns Absolute path, or null when the git directory cannot be resolved / 解決できない場合は null
 */
export function resolveExcludeFile(worktreePath: string): string | null {
  const dotGit = join(worktreePath, '.git');
  if (!existsSync(dotGit)) return null;

  let gitDir = dotGit;
  try {
    const contents = readFileSync(dotGit, 'utf8');
    const match = contents.match(/^gitdir:\s*(.+)$/m);
    if (match?.[1]) {
      // A worktree's gitdir is <common>/worktrees/<name>; info/exclude lives in
      // the common directory, so climb out of the per-worktree subdirectory.
      const perWorktree = resolve(worktreePath, match[1].trim());
      gitDir = resolve(perWorktree, '../..');
    }
  } catch {
    // Reading a DIRECTORY .git throws EISDIR on Windows — that is the main
    // checkout, where .git itself is the git directory.
  }

  return join(gitDir, 'info', 'exclude');
}
