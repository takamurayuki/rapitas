/**
 * Workflow Auto Commit — Tree identity
 *
 * A commit-stable, byte-exact identity of "what the commit records": the git
 * tree object id. Before the commit it is the tree `git add -A` WOULD record,
 * built in a throwaway index; after the commit it is HEAD's tree. Tree ids
 * hash every blob's bytes and every entry's mode, so any content change
 * (including `++…` lines, a final newline, binaries) or mode change differs.
 * Not responsible for deciding what a mismatch means (workflow-auto-commit-binding.ts).
 *
 * NOTE: Patch text is not used on purpose. getDiff synthesizes an untracked
 * file's patch differently from `git diff`, and any normalization of patch
 * text that bridges the two loses content (G2 re-review 2, item 1).
 */
import { execFile } from 'child_process';
import { copyFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return stdout;
}

/**
 * Tree id the commit step would record from the worktree right now: a copy of
 * the index, `git add -A`, minus the top-level `.wf-*` files the commit step
 * deletes before staging (core-ops removeTransientWorkflowFiles). The real
 * index and the worktree are not touched. Never throws.
 *
 * @param cwd - Directory the commit runs in / コミットを実行するディレクトリ
 * @returns Tree object id, or null when it cannot be computed / tree の id（取れなければ null）
 */
export async function stagedTreeIdentity(cwd: string): Promise<string | null> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), 'rapitas-tree-id-'));
    const index = join(dir, 'index');
    const env = { GIT_INDEX_FILE: index };
    const realIndex = resolve(cwd, (await git(cwd, ['rev-parse', '--git-path', 'index'])).trim());
    // A missing index (nothing staged yet) starts from HEAD's tree instead.
    const copied = await copyFile(realIndex, index).then(
      () => true,
      () => false,
    );
    if (!copied) await git(cwd, ['read-tree', 'HEAD'], env);
    await git(cwd, ['add', '-A'], env);
    // Mirror the commit step: it unlinks top-level `.wf-*` entries of cwd first.
    const transient = (await git(cwd, ['ls-files', '-z'], env))
      .split('\0')
      .filter((p) => p.startsWith('.wf-') && !p.includes('/'));
    if (transient.length > 0) {
      await git(cwd, ['update-index', '--force-remove', '--', ...transient], env);
    }
    return (await git(cwd, ['write-tree'], env)).trim() || null;
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Tree id of the commit just recorded (HEAD). Never throws.
 *
 * @param cwd - Directory the commit ran in / コミットしたディレクトリ
 * @returns Tree object id, or null when unreadable / tree の id（取れなければ null）
 */
export async function committedTreeIdentity(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['rev-parse', 'HEAD^{tree}'])).trim() || null;
  } catch {
    return null;
  }
}
