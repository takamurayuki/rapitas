/**
 * GitOperations — PR Draft Ready Promotion
 *
 * Promotes a draft PR to ready-for-review (`gh pr ready`) once its verdict
 * has turned pass. Not responsible for creating the PR or deciding when it
 * should be promoted — that is the caller's (task 1099).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../../config/logger';
import { ghPath } from './gh-cli-path';

const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/pr-draft-ops');

// `gh` calls hit the network (GitHub API); 120s gives real requests headroom
// while still bounding a hang so the pipeline can't stall on it.
const GIT_SLOW_OP_TIMEOUT_MS = 120_000;

/**
 * Marks a draft PR ready for review. Best-effort — a failure is logged, not
 * thrown, so the publish pipeline is never failed by this step; the PR
 * simply stays draft and remains open to a manual `gh pr ready` / GitHub UI
 * action (see plan.md's 申し送り事項 #4).
 *
 * @param workingDirectory - Repository directory / リポジトリのディレクトリ
 * @param prNumber - PR number to promote / 対象PR番号
 * @returns True when `gh pr ready` succeeded / 成功したか
 */
export async function readyPullRequest(
  workingDirectory: string,
  prNumber: number,
): Promise<boolean> {
  try {
    await execFileAsync(ghPath(), ['pr', 'ready', String(prNumber)], {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout: GIT_SLOW_OP_TIMEOUT_MS,
    });
    logger.info(`[readyPullRequest] Marked PR #${prNumber} ready for review`);
    return true;
  } catch (err) {
    logger.warn({ err, prNumber }, `[readyPullRequest] Failed to mark PR #${prNumber} ready`);
    return false;
  }
}
