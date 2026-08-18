/**
 * ClaudeCodeAgent Git Diff Checker
 *
 * Detects whether the agent produced actual code changes by inspecting the git working tree.
 * Not responsible for process management or output parsing.
 * Uses the shared git-exec layer for consistent error handling and logging.
 */

import { createLogger } from '../../../config/logger';
import { runGitCommand } from '../../github/git-exec';

const logger = createLogger('claude-code-agent');

/**
 * Checks whether this task's branch carries any code changes.
 * Examines unstaged changes, staged changes, working tree status, recent
 * commits, and finally commits the branch holds that no base branch has — the
 * last one so a re-run on an already-implemented branch is not misreported as
 * "the agent only planned".
 *
 * @param workDir - Absolute path to a git repository / gitリポジトリへの絶対パス
 * @param logPrefix - Logger prefix for this agent instance / ロガーのプレフィックス
 * @returns true if any changes are detected / 変更が検出されればtrue
 * @throws {Error} If workDir is not a git repository / workDirがgitリポジトリでない場合
 */
export async function checkGitDiff(workDir: string, logPrefix: string): Promise<boolean> {
  // 0. Verify this is a git repository
  const revParse = await runGitCommand(['rev-parse', '--is-inside-work-tree'], workDir, {
    timeoutMs: 5000,
  });
  if (revParse !== 'true') {
    throw new Error(`workDir is not a git repository: ${workDir}`);
  }

  // 1. Unstaged changes
  const unstaged = await runGitCommand(['diff', '--stat', 'HEAD'], workDir, { timeoutMs: 5000 });
  if (unstaged.length > 0) {
    logger.info(`${logPrefix} Git diff check: unstaged changes found`);
    return true;
  }

  // 2. Staged changes
  const staged = await runGitCommand(['diff', '--cached', '--stat'], workDir, {
    timeoutMs: 5000,
  });
  if (staged.length > 0) {
    logger.info(`${logPrefix} Git diff check: staged changes found`);
    return true;
  }

  // 3. Working tree changes (agent may have committed already)
  const status = await runGitCommand(['status', '--porcelain'], workDir, { timeoutMs: 5000 });
  if (status.length > 0) {
    logger.info(`${logPrefix} Git diff check: working tree changes found`);
    return true;
  }

  // 4. Recent commits made during this execution (within the last 5 minutes)
  const recentCommit = await runGitCommand(
    ['log', '--oneline', '--since=5.minutes.ago', '-1'],
    workDir,
    { timeoutMs: 5000 },
  );
  if (recentCommit.length > 0) {
    logger.info(`${logPrefix} Git diff check: recent commit found: ${recentCommit}`);
    return true;
  }

  // 5. Commits this branch carries that no base branch has yet.
  //
  // Checks 1-4 all ask "did THIS run touch the tree?", which is false for a
  // re-run whose implementation was already COMMITTED by an earlier run in the
  // same reused worktree: the tree is clean and the commits are older than the
  // 5-minute window. The run was then reported as "no actual code changes were
  // made", even though the branch holds the whole implementation. Observed on
  // task 633: a retry at 09:24 was marked failed, while the very same branch
  // produced PR #437, which merged 18 minutes later.
  //
  // Local refs only — no fetch. This runs at the end of EVERY execution, so it
  // must stay cheap; a stale local base only ever makes the count larger, never
  // hiding real work. Candidate bases mirror resolveBaseRef's develop→main→
  // master order, and `--not` excludes anything already reachable from any of
  // them, leaving exactly this branch's own commits.
  const branchCommits = await runGitCommand(
    [
      'rev-list',
      '--count',
      'HEAD',
      '--not',
      'origin/develop',
      'develop',
      'origin/main',
      'main',
      'origin/master',
      'master',
    ],
    workDir,
    { timeoutMs: 5000 },
  ).catch(() => '');
  if (branchCommits && parseInt(branchCommits, 10) > 0) {
    logger.info(
      `${logPrefix} Git diff check: working tree is clean, but the branch carries ${branchCommits} commit(s) not on any base branch — treating as changes present`,
    );
    return true;
  }

  logger.info(`${logPrefix} Git diff check: no changes detected`);
  return false;
}
