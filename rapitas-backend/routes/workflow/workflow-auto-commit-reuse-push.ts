/**
 * workflow-auto-commit-reuse-push
 *
 * Pushes the task branch when the auto-commit epilogue REUSES an already-open
 * PR instead of creating one. Not responsible for PR creation, base sync, or
 * deciding whether a PR exists.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';

const execFileAsync = promisify(execFile);
const log = createLogger('routes:workflow:auto-commit:reuse-push');

// `git push` hits the network; 120s bounds a hang without cutting real pushes short.
const GIT_PUSH_TIMEOUT_MS = 120_000;

/** Outcome of {@link pushExistingPrBranch}. */
export interface ReusePushResult {
  success: boolean;
  error?: string;
}

/** Minimal git runner shape — injectable so tests never mock child_process globally. */
export type GitPushRunner = (
  args: string[],
  opts: { cwd: string; timeout: number },
) => Promise<unknown>;

const defaultRunner: GitPushRunner = (args, opts) => execFileAsync('git', args, opts);

/**
 * Push `branch` to origin so an existing PR picks up the newly saved commit.
 *
 * Exists because createPullRequest (the create path) pushes before opening a
 * PR, but the task-scoped "already has open PR — reusing" short-circuit in the
 * epilogue returned success WITHOUT pushing. Every ci_repair fix — which by
 * definition targets an open PR — was therefore committed locally and never
 * reached GitHub (tasks 995 and 1002, 2026-09-20; concern #10694).
 *
 * No rename-on-divergence fallback here: the PR is bound to THIS branch name,
 * so a non-fast-forward push must surface as a failure, not move the work to
 * a branch the PR does not watch.
 *
 * @param cwd - Worktree / repository directory. / 作業ディレクトリ
 * @param branch - Branch the open PR was created from. / PR の head ブランチ
 * @param run - git runner (default: execFile git); injectable for tests. / git 実行関数
 * @returns success, or the git error message. / 成否と git のエラー
 */
export async function pushExistingPrBranch(
  cwd: string,
  branch: string,
  run: GitPushRunner = defaultRunner,
): Promise<ReusePushResult> {
  try {
    await run(['push', 'origin', branch], { cwd, timeout: GIT_PUSH_TIMEOUT_MS });
    log.info({ cwd, branch }, '[Workflow] Pushed task branch to the existing PR');
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, cwd, branch }, '[Workflow] Push to the existing PR branch failed');
    return { success: false, error: message };
  }
}
