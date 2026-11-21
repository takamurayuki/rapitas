/**
 * investigation-base-snapshot
 *
 * Picks the directory the read-only investigation roles (researcher, planner,
 * criteria review) read when a task has no worktree yet: the theme's primary
 * checkout when it sits clean on the tip of the base branch, otherwise a
 * detached worktree of `origin/<base>`. Not responsible for implementation
 * worktrees (worktree-create.ts) or for changing the primary checkout.
 *
 * NOTE: trendline's primary checkout sat on master from 2026-07-09, 43 commits
 * behind develop (theme 18's base), while every implementation worktree was cut
 * from origin/develop. Investigation read the primary, so tasks were researched
 * against July code: 1523 was filed with "web/ has no tests" (it has 19) and
 * 1524 was told scripts/pidfile.mjs did not exist (2026-11-21). The owner chose
 * to fix this here rather than move their checkout, which also holds their
 * uncommitted edits.
 */
import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:investigation-base-snapshot');
const execFileAsync = promisify(execFile);

const SNAPSHOT_PREFIX = '_base-';
/** Snapshots kept per repo; older ones are removed when a new one is made. */
const KEEP_SNAPSHOTS = 2;
const GIT_TIMEOUT_MS = 60_000;

/** Side effects of {@link resolveInvestigationWorkDir}, injectable for tests. */
export interface SnapshotDeps {
  /** Run git in `cwd` and return stdout; throws on failure. */
  git: (args: string[], cwd: string) => Promise<string>;
  exists: (path: string) => boolean;
  /** Absolute paths of existing snapshot worktrees of this repo. */
  listSnapshots: (repoDir: string) => string[];
}

const liveDeps: SnapshotDeps = {
  git: async (args, cwd) =>
    (await execFileAsync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS })).stdout,
  exists: existsSync,
  listSnapshots: (repoDir) => {
    const root = join(repoDir, '.worktrees');
    try {
      return readdirSync(root)
        .filter((name) => name.startsWith(SNAPSHOT_PREFIX))
        .map((name) => join(root, name));
    } catch {
      return [];
    }
  },
};

/**
 * Directory an investigation role should read for a task without a worktree.
 * Fails open to `themeWorkDir` (the previous behaviour) on any git error.
 *
 * @param themeWorkDir - The theme's primary checkout / テーマの作業ディレクトリ
 * @param baseBranch - Branch implementation worktrees are cut from / 基準ブランチ
 * @param deps - Side effects / 副作用
 * @returns Directory to read / 調査で読むディレクトリ
 */
export async function resolveInvestigationWorkDir(
  themeWorkDir: string,
  baseBranch: string | null,
  deps: SnapshotDeps = liveDeps,
): Promise<string> {
  if (!baseBranch) return themeWorkDir;
  try {
    // Same best-effort refresh as worktree-create.ts: offline keeps the cache.
    await deps.git(['fetch', 'origin', baseBranch], themeWorkDir).catch((err) => {
      log.warn({ err, baseBranch }, 'fetch failed — reading the cached base ref');
    });
    const tip = (
      await deps.git(['rev-parse', '--verify', `origin/${baseBranch}^{commit}`], themeWorkDir)
    ).trim();
    const head = (await deps.git(['rev-parse', 'HEAD'], themeWorkDir)).trim();
    const dirty = (await deps.git(['status', '--porcelain'], themeWorkDir)).trim() !== '';
    if (head === tip && !dirty) return themeWorkDir;

    const dir = join(themeWorkDir, '.worktrees', `${SNAPSHOT_PREFIX}${tip.slice(0, 12)}`);
    if (!deps.exists(dir)) {
      await deps.git(['worktree', 'add', '--detach', dir, tip], themeWorkDir);
      log.info({ themeWorkDir, baseBranch, tip, dir }, 'investigation reads a base snapshot');
    }
    await pruneSnapshots(themeWorkDir, dir, deps);
    return dir;
  } catch (err) {
    log.warn({ err, themeWorkDir, baseBranch }, 'base snapshot unavailable — reading the checkout');
    return themeWorkDir;
  }
}

/** Remove snapshots beyond the newest {@link KEEP_SNAPSHOTS}, never `keep`. */
async function pruneSnapshots(repoDir: string, keep: string, deps: SnapshotDeps): Promise<void> {
  // Sorted by name is not by age; the current one is always kept and the rest
  // are dropped oldest-first by listing order, which is enough to bound disk.
  const others = deps.listSnapshots(repoDir).filter((d) => d !== keep);
  const excess = others.length - (KEEP_SNAPSHOTS - 1);
  for (const dir of others.slice(0, Math.max(0, excess))) {
    await deps
      .git(['worktree', 'remove', '--force', dir], repoDir)
      .catch((err) => log.debug({ err, dir }, 'could not remove an old base snapshot'));
  }
}
