/**
 * ClaudeCodeAgent Git Diff Checker
 *
 * Detects whether the agent produced actual code changes by inspecting the git working tree.
 * Not responsible for process management or output parsing.
 */

import { spawn } from 'child_process';
import { createLogger } from '../../../config/logger';

const logger = createLogger('claude-code-agent');

/**
 * Runs a single git command in the given directory and returns its stdout.
 *
 * @param workDir - Directory to run git in / gitを実行するディレクトリ
 * @param args - git arguments / git引数
 * @returns Trimmed stdout string / トリムされた標準出力文字列
 * @throws {Error} If git exits non-zero or times out after 5 seconds / gitが非ゼロで終了するかタイムアウト時
 */
function runGitCommand(workDir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: workDir, shell: true });

    let output = '';
    // NOTE: 5-second timeout prevents hanging when git is unavailable or the repo is very large.
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`git ${args.join(' ')} timed out`));
    }, 5000);

    proc.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      resolve(output.trim());
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`git ${args.join(' ')} failed: ${err.message}`));
    });
  });
}

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
  const revParse = await runGitCommand(workDir, ['rev-parse', '--is-inside-work-tree']);
  if (revParse !== 'true') {
    throw new Error(`workDir is not a git repository: ${workDir}`);
  }

  // 1. Unstaged changes
  const unstaged = await runGitCommand(workDir, ['diff', '--stat', 'HEAD']);
  if (unstaged.length > 0) {
    logger.info(`${logPrefix} Git diff check: unstaged changes found`);
    return true;
  }

  // 2. Staged changes
  const staged = await runGitCommand(workDir, ['diff', '--cached', '--stat']);
  if (staged.length > 0) {
    logger.info(`${logPrefix} Git diff check: staged changes found`);
    return true;
  }

  // 3. Working tree changes (agent may have committed already)
  const status = await runGitCommand(workDir, ['status', '--porcelain']);
  if (status.length > 0) {
    logger.info(`${logPrefix} Git diff check: working tree changes found`);
    return true;
  }

  // 4. Recent commits made during this execution (within the last 5 minutes)
  const recentCommit = await runGitCommand(workDir, ['log', '--oneline', '--since=5.minutes.ago', '-1']);
  if (recentCommit.length > 0) {
    logger.info(`${logPrefix} Git diff check: recent commit found: ${recentCommit}`);
    return true;
  }

  logger.info(`${logPrefix} Git diff check: no changes detected`);
  return false;
}
