/**
 * pre-pr-base-sync-format
 *
 * Runs prettier over the files the aux conflict resolver just rewrote, before
 * they are staged and re-verified. A one-shot text model reproduces whole
 * files and routinely slips on formatting; the verification gate then fails
 * on `format=NG` for code that is otherwise correct (task 1036, 2026-09-22:
 * conflict on log-health-suppressions.ts resolved → format=NG(2) → PR
 * withheld → task blocked → blind auto-retry six minutes later). Formatting
 * is mechanical, so apply it instead of failing on it. Best effort: a
 * prettier failure is logged and ignored — the re-verify still decides.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:base-sync-format');
const execFileAsync = promisify(execFile);

/** Extensions prettier formats in this repo (mirrors the gate's format check). */
const FORMATTABLE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|ya?ml)$/i;

/** Injected runner: (cwd, files relative to cwd) → resolves when formatted. */
export type PrettierRunner = (cwd: string, files: string[]) => Promise<void>;

const defaultRunner: PrettierRunner = async (cwd, files) => {
  await execFileAsync('bunx', ['prettier', '--write', ...files], {
    cwd,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
};

/**
 * Nearest ancestor directory (inclusive) of `file` that holds a package.json,
 * so prettier picks up that package's config and binary; falls back to the
 * worktree root.
 *
 * @param gitCwd - Worktree root / worktree ルート
 * @param file - Path relative to the worktree / 相対パス
 * @returns Absolute package directory / パッケージディレクトリ
 */
export function packageRootFor(gitCwd: string, file: string): string {
  let dir = dirname(join(gitCwd, file));
  const stop = join(gitCwd);
  while (dir.startsWith(stop) && dir !== stop) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return gitCwd;
}

/**
 * Format the given worktree-relative files with each package's own prettier.
 *
 * @param gitCwd - Worktree root / worktree ルート
 * @param files - Files the resolver rewrote, relative to gitCwd / 解消したファイル
 * @param run - Prettier runner (injectable for tests) / 実行関数
 * @returns Files that were handed to prettier, grouped by package / 整形対象
 */
export async function formatResolvedFiles(
  gitCwd: string,
  files: string[],
  run: PrettierRunner = defaultRunner,
): Promise<Record<string, string[]>> {
  const groups: Record<string, string[]> = {};
  for (const file of files) {
    if (!FORMATTABLE_RE.test(file)) continue;
    const root = packageRootFor(gitCwd, file);
    (groups[root] ??= []).push(relative(root, join(gitCwd, file)).replace(/\\/g, '/'));
  }
  for (const [root, rel] of Object.entries(groups)) {
    try {
      await run(root, rel);
    } catch (err) {
      log.warn(
        { err, root, files: rel },
        '[base-sync] prettier on resolved files failed — continuing',
      );
    }
  }
  return groups;
}
