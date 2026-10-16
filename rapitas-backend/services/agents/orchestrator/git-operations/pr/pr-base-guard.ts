/**
 * GitOperations — PR Base Branch Guard
 *
 * Verifies a PR's actual base matches the intended target and retargets
 * if gh opened it against a different branch (best-effort).
 * Not responsible for creating the PR itself.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../../config/logger';
import { ghPath } from './gh-cli-path';

// NOTE: execFile (array-args, no shell) instead of exec (shell string) — branch
// names, base branches, and other caller-controlled values are passed as
// literal argv elements, so shell metacharacters in them can't be interpreted.
const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/pr-base-guard');

// `gh` calls hit the network (GitHub API); 120s gives real requests headroom
// while still bounding a hang so the implementer phase can't stall on it.
const GIT_SLOW_OP_TIMEOUT_MS = 120_000;

/**
 * Ensure a PR's base matches the intended target, retargeting if gh opened it
 * against a different branch. Best-effort — a failure is logged, not thrown, so
 * PR creation still succeeds.
 *
 * @param workingDirectory - Repository directory / リポジトリのディレクトリ
 * @param prNumber - PR number to verify / 確認するPR番号
 * @param intended - The base branch the PR should target / 本来のベースブランチ
 */
export async function ensurePrBase(
  workingDirectory: string,
  prNumber: number,
  intended: string,
): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      ghPath(),
      ['pr', 'view', String(prNumber), '--json', 'baseRefName', '--jq', '.baseRefName'],
      { cwd: workingDirectory, encoding: 'utf8', timeout: GIT_SLOW_OP_TIMEOUT_MS },
    );
    const actual = stdout.trim();
    if (actual && actual !== intended) {
      await execFileAsync(ghPath(), ['pr', 'edit', String(prNumber), '--base', intended], {
        cwd: workingDirectory,
        encoding: 'utf8',
        timeout: GIT_SLOW_OP_TIMEOUT_MS,
      });
      logger.info(`[createPullRequest] Corrected PR #${prNumber} base ${actual} -> ${intended}`);
    }
  } catch (err) {
    logger.warn(
      { err, prNumber, intended },
      `[createPullRequest] Failed to verify/correct PR #${prNumber} base`,
    );
  }
}
