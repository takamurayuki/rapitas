/**
 * WorktreeCommandWrapper
 *
 * Provisions `scripts/run-checked.cjs` inside a generated project's worktree so
 * the heartbeat/exit-code wrapper every agent prompt instructs them to use is
 * actually executable there.
 * Not responsible for dependencies (dependency-installer.ts) or for deciding
 * which commands an agent runs.
 */

import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { appendExcludeBlock, resolveExcludeFile } from '../core/git-exclude';

/** Path of the wrapper inside a worktree, and the exclude entry that hides it. */
export const WRAPPER_RELATIVE_PATH = 'scripts/run-checked.cjs';

/**
 * rapitas's own copy of the wrapper. Derived from this module's location so it
 * follows the checkout rather than an absolute path baked into a config.
 *
 * @param moduleDir - Directory of the calling module / 呼び出し元モジュールのディレクトリ
 * @returns Absolute path to rapitas's wrapper / rapitas 同梱ラッパーの絶対パス
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
 * The copy is excluded via the repository's local exclude list rather than left
 * untracked, so an agent running `git add .` cannot commit rapitas's internal
 * tooling into the generated app's repository.
 *
 * @param worktreePath - Worktree root to provision / 対象 worktree のルート
 * @param source - Wrapper to copy; defaults to rapitas's own / コピー元（既定は rapitas 同梱）
 * @returns What was done / 実施内容
 */
export async function ensureRunCheckedWrapper(
  worktreePath: string,
  source: string,
): Promise<WrapperAction> {
  const destination = join(worktreePath, WRAPPER_RELATIVE_PATH);
  if (existsSync(destination)) return 'present';
  if (!existsSync(source)) return 'source-missing';

  await fsPromises.mkdir(dirname(destination), { recursive: true });
  await fsPromises.copyFile(source, destination);

  const excludeFile = resolveExcludeFile(worktreePath);
  if (excludeFile) {
    try {
      await appendExcludeBlock(
        excludeFile,
        'Provisioned by rapitas so agents can run verification with a heartbeat.',
        [WRAPPER_RELATIVE_PATH],
      );
    } catch {
      // An unwritable exclude file is not worth failing the bootstrap over: the
      // wrapper still works, it is merely visible to `git status`.
    }
  }

  return 'copied';
}
