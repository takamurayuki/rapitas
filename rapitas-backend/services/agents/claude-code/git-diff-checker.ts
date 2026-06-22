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
 * Checks whether there are any code changes in the working directory.
 * Examines unstaged changes, staged changes, working tree status, and recent commits.
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

  logger.info(`${logPrefix} Git diff check: no changes detected`);
  return false;
}
