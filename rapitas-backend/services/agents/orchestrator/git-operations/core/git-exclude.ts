/**
 * GitExclude
 *
 * Appends patterns to a repository's local `info/exclude`, once per pattern.
 * Not responsible for `.gitignore` (which is tracked and belongs to the
 * project) or for deciding what should be ignored.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

/** Outcome of an append, for logging. */
export type ExcludeAppendResult = 'added' | 'already-present';

/**
 * Add patterns to an exclude file unless they are all already listed.
 *
 * NOTE: The dedup is the point. `info/exclude` lives in the COMMON git
 * directory, so every worktree of a repository shares one file — an
 * unconditional append re-adds the same block on every worktree creation.
 * Measured 2026-10-11 on rapitas's own checkout: 5547 lines holding 1380
 * copies of the same three-line block, re-parsed by every `git status`,
 * `git add` and `git diff` in the repo and in all of its worktrees.
 *
 * @param excludePath - Path to the exclude file / exclude ファイルのパス
 * @param comment - Header line written above the patterns, without `#` / パターン上部のコメント（`#` 不要）
 * @param patterns - Patterns to ensure are present / 追加したいパターン
 * @returns Whether anything was written / 書き込んだかどうか
 */
export async function appendExcludeBlock(
  excludePath: string,
  comment: string,
  patterns: readonly string[],
): Promise<ExcludeAppendResult> {
  const existing = existsSync(excludePath) ? await fsPromises.readFile(excludePath, 'utf8') : '';
  const lines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = patterns.filter((p) => !lines.has(p));
  if (missing.length === 0) return 'already-present';

  await fsPromises.mkdir(dirname(excludePath), { recursive: true });
  // Keep the block on its own lines even when the file had no trailing newline.
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await fsPromises.appendFile(
    excludePath,
    `${prefix}# ${comment}\n${missing.join('\n')}\n`,
    'utf8',
  );
  return 'added';
}

/**
 * Locate `info/exclude` for a worktree or main checkout.
 *
 * NOTE: In a linked worktree `.git` is a FILE pointing at
 * `<common>/worktrees/<name>`; the exclude file lives in the common directory,
 * so the per-worktree subdirectory has to be climbed out of.
 *
 * @param worktreePath - Worktree or checkout root / worktree またはチェックアウトのルート
 * @returns Absolute path, or null when there is no `.git` / `.git` が無い場合は null
 */
export function resolveExcludeFile(worktreePath: string): string | null {
  const dotGit = join(worktreePath, '.git');
  if (!existsSync(dotGit)) return null;

  let gitDir = dotGit;
  try {
    const match = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
    if (match?.[1]) {
      gitDir = resolve(resolve(worktreePath, match[1].trim()), '../..');
    }
  } catch {
    // Reading a DIRECTORY `.git` throws EISDIR — that is the main checkout,
    // where `.git` itself is the git directory.
  }

  return join(gitDir, 'info', 'exclude');
}
