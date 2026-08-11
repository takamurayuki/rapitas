/**
 * AutoRestartMergedCodeGitIO
 *
 * Thin git I/O layer for the merged-code auto-restart: capture the boot
 * commit, count origin commits ahead of it, check tree cleanliness, and
 * fast-forward. All commands go through runGitCommand (array-form execFile)
 * against the backend's own checkout (process cwd — git resolves the repo
 * root upward), never a theme workingDirectory.
 * Not responsible for deciding whether to restart — see decision.ts.
 */
import { runGitCommand } from '../../github/git-exec';
import { createLogger } from '../../../config/logger';

const log = createLogger('auto-restart-merged-code:git');

/**
 * Capture the commit this backend process booted on.
 *
 * @returns HEAD commit hash, or null when git is unavailable / 起動時HEAD、取得失敗時はnull
 */
export async function captureStartupCommit(): Promise<string | null> {
  try {
    const head = await runGitCommand(['rev-parse', 'HEAD'], undefined, { skipLog: true });
    return head || null;
  } catch {
    return null;
  }
}

/**
 * Fetch origin/<branch> and count commits ahead of the given startup commit.
 * The startup commit (not the current local HEAD) is the base so a completed
 * fast-forward pull without a restart keeps reporting a non-zero count until
 * the process actually relaunches on the new code.
 *
 * @param startupCommit - Commit the process booted on / 起動時コミット
 * @param branch - Branch name to compare against (e.g. develop) / 比較対象ブランチ名
 * @returns Ahead count, or null when fetch/rev-list failed (skip this tick) / 未活性コミット数、失敗時はnull
 */
export async function fetchAndCountAhead(
  startupCommit: string,
  branch: string,
): Promise<number | null> {
  try {
    await runGitCommand(['fetch', 'origin', branch], undefined, {
      skipLog: true,
      timeoutMs: 60_000,
    });
    const out = await runGitCommand(
      ['rev-list', '--count', `${startupCommit}..origin/${branch}`],
      undefined,
      { skipLog: true },
    );
    const count = Number.parseInt(out, 10);
    return Number.isFinite(count) ? count : null;
  } catch (err) {
    log.warn({ err, branch }, '[auto-restart] fetch/rev-list failed — skipping this tick');
    return null;
  }
}

/**
 * Whether the working tree has no uncommitted changes. A dirty tree blocks
 * the fast-forward pull (self-dev agents may be editing the primary checkout).
 *
 * @returns True when `git status --porcelain` output is empty / 未コミット変更がなければtrue
 */
export async function isWorkingTreeClean(): Promise<boolean> {
  try {
    const out = await runGitCommand(['status', '--porcelain'], undefined, { skipLog: true });
    return out.length === 0;
  } catch (err) {
    // NOTE: Treat "can't tell" as dirty — never pull over an unknown tree state.
    log.warn({ err }, '[auto-restart] git status failed — treating tree as dirty');
    return false;
  }
}

/**
 * Fast-forward the local branch to origin/<branch>. `--ff-only` makes git
 * itself fail safely on divergence or conflicts (no force pull / reset).
 *
 * @param branch - Branch name to fast-forward to / fast-forward先ブランチ名
 * @returns True on success, false on any failure / 成功時true、失敗時false
 */
export async function fastForwardToRemote(branch: string): Promise<boolean> {
  try {
    await runGitCommand(['merge', '--ff-only', `origin/${branch}`], undefined, {
      skipLog: true,
      timeoutMs: 60_000,
    });
    return true;
  } catch (err) {
    log.warn({ err, branch }, '[auto-restart] fast-forward merge failed — restart skipped');
    return false;
  }
}
