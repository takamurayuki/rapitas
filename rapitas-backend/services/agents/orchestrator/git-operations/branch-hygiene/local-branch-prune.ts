/**
 * LocalBranchPrune
 *
 * Deletes LOCAL branches whose work is provably preserved elsewhere, as part of
 * the worktree cleanup cycle. Not responsible for remote branches (GitHub's
 * "delete branch on merge" owns those) or for worktrees (worktree-cleanup.ts).
 *
 * Why (#1403): local branches had piled up to 211 and were pruned by hand to
 * 16; nothing pruned them afterwards. removeWorktree deletes the branch of a
 * worktree it removes, but branches whose worktree was removed some other way,
 * or that never had one, stayed forever.
 *
 * A branch is deleted only when ALL of these hold — anything unknown keeps it:
 * - its name is not main/develop/master;
 * - it is not checked out in any worktree (checked twice: before deciding and
 *   again right before deleting);
 * - no remote-tracking branch of the same name, and no configured upstream
 *   other than origin/develop or origin/main, exists after `git fetch --prune`
 *   (a failed fetch skips the whole cycle);
 * - its tip is an ancestor of origin/develop, or is an ancestor of (or equal
 *   to) the head commit of a MERGED/CLOSED pull request from that branch.
 * Deletion is `update-ref -d <ref> <tip>`, which refuses if the branch moved
 * after it was judged.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../../../../../config/logger';
import type { PullRequestHead } from '../../../../github/pr-head-lookup';

const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/local-branch-prune');

/** Branches no sweep may delete, whatever their state. */
const PROTECTED_BRANCHES = new Set(['main', 'develop', 'master']);
/** The integration branch whose history counts as "preserved". */
const INTEGRATION_REF = 'refs/remotes/origin/develop';
/** Upstreams that say where a branch was cut from, not that it was pushed. */
const SHARED_UPSTREAMS = new Set(['refs/remotes/origin/develop', 'refs/remotes/origin/main']);
/** Bounds gh calls per cycle; branches past it are simply kept until a later cycle. */
const MAX_PR_LOOKUPS_PER_CYCLE = 20;
const GIT_TIMEOUT_MS = 60_000;
/** A fetch talks to the network; give it more room than a local read. */
const FETCH_TIMEOUT_MS = 120_000;

/** Outcome of one git invocation; never thrown, so "unknown" is always explicit. */
export interface GitResult {
  /** Exit code, or -1 when git could not be run or timed out. */
  code: number;
  stdout: string;
}

/** Injectable collaborators. */
export interface LocalBranchPruneDeps {
  git?: (args: string[], cwd: string, timeoutMs?: number) => Promise<GitResult>;
  listPullRequestsForHead?: (repoDir: string, branch: string) => Promise<PullRequestHead[] | null>;
}

/** What one cycle did. */
export interface LocalBranchPruneResult {
  examined: number;
  deleted: string[];
  kept: number;
  /** Set when the cycle stopped before judging any branch. */
  skipped?: 'fetch-failed' | 'worktree-list-failed' | 'ref-list-failed';
}

async function runGit(args: string[], cwd: string, timeoutMs = GIT_TIMEOUT_MS): Promise<GitResult> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
    });
    return { code: 0, stdout };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return { code: typeof code === 'number' ? code : -1, stdout: '' };
  }
}

/** Branches checked out in any worktree of the repository, or null if unknown. */
async function checkedOutBranches(
  git: NonNullable<LocalBranchPruneDeps['git']>,
  baseDir: string,
): Promise<Set<string> | null> {
  const list = await git(['worktree', 'list', '--porcelain'], baseDir);
  if (list.code !== 0) return null;
  const branches = new Set<string>();
  for (const m of list.stdout.matchAll(/^branch refs\/heads\/(.+?)\r?$/gm)) branches.add(m[1]!);
  return branches;
}

/** `git merge-base --is-ancestor`: true / false, or null when git could not tell. */
async function isAncestor(
  git: NonNullable<LocalBranchPruneDeps['git']>,
  baseDir: string,
  commit: string,
  of: string,
): Promise<boolean | null> {
  const r = await git(['merge-base', '--is-ancestor', commit, of], baseDir);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  return null;
}

/**
 * Delete local branches whose work is provably preserved (see the module header
 * for the exact conditions).
 *
 * @param baseDir - Main repository root / メインリポジトリのルート
 * @param deps - Overrides for tests / テスト用の差し替え
 * @returns Counts and the deleted branch names / 件数と削除したブランチ名
 */
export async function pruneMergedLocalBranches(
  baseDir: string,
  deps: LocalBranchPruneDeps = {},
): Promise<LocalBranchPruneResult> {
  const git = deps.git ?? runGit;
  const lookupPrs =
    deps.listPullRequestsForHead ??
    (async (dir: string, branch: string) => {
      const { listPullRequestsForHead } = await import('../../../../github/pr-head-lookup');
      return listPullRequestsForHead(dir, branch);
    });
  const result: LocalBranchPruneResult = { examined: 0, deleted: [], kept: 0 };

  // Without a fresh view of origin, "the remote branch is gone" is a guess.
  if (
    (await git(['fetch', '--prune', '--quiet', 'origin'], baseDir, FETCH_TIMEOUT_MS)).code !== 0
  ) {
    logger.warn('[pruneMergedLocalBranches] git fetch --prune failed; skipping this cycle');
    return { ...result, skipped: 'fetch-failed' };
  }

  const checkedOut = await checkedOutBranches(git, baseDir);
  if (!checkedOut) return { ...result, skipped: 'worktree-list-failed' };

  const heads = await git(
    ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(upstream)', 'refs/heads/'],
    baseDir,
  );
  const remotes = await git(['for-each-ref', '--format=%(refname)', 'refs/remotes/'], baseDir);
  if (heads.code !== 0 || remotes.code !== 0) return { ...result, skipped: 'ref-list-failed' };

  const remoteRefs = new Set(remotes.stdout.split(/\r?\n/).filter(Boolean));
  const remoteBranchNames = new Set(
    [...remoteRefs].map((ref) => ref.split('/').slice(3).join('/')).filter(Boolean),
  );
  const hasIntegrationRef = remoteRefs.has(INTEGRATION_REF);

  const deletable: Array<{ branch: string; tip: string }> = [];
  let prLookups = 0;
  for (const line of heads.stdout.split(/\r?\n/).filter(Boolean)) {
    const [ref, tip, upstream] = line.split('\t');
    if (!ref || !tip) continue;
    const branch = ref.replace(/^refs\/heads\//, '');
    result.examined++;

    if (PROTECTED_BRANCHES.has(branch) || checkedOut.has(branch)) continue;
    // Any remote still carrying a branch of this name, or a live upstream, means
    // it is not "gone" — GitHub-side cleanup has not happened, so neither do we.
    // An upstream of origin/develop or origin/main is the exception: it only
    // records where the branch was cut from (`git switch -c x origin/develop`),
    // not a remote copy of the branch, and would otherwise keep it forever.
    const liveUpstream = !!upstream && remoteRefs.has(upstream) && !SHARED_UPSTREAMS.has(upstream);
    if (remoteBranchNames.has(branch) || liveUpstream) continue;

    let preserved = hasIntegrationRef
      ? (await isAncestor(git, baseDir, tip, INTEGRATION_REF)) === true
      : false;

    if (!preserved && prLookups < MAX_PR_LOOKUPS_PER_CYCLE) {
      prLookups++;
      const prs = await lookupPrs(baseDir, branch);
      for (const pr of prs ?? []) {
        if (pr.state !== 'MERGED' && pr.state !== 'CLOSED') continue;
        if (
          pr.headRefOid === tip ||
          (await isAncestor(git, baseDir, tip, pr.headRefOid)) === true
        ) {
          preserved = true;
          break;
        }
      }
    }
    if (preserved) deletable.push({ branch, tip });
  }

  // A worktree may have checked one of these out while the PR lookups ran.
  const checkedOutNow = deletable.length > 0 ? await checkedOutBranches(git, baseDir) : checkedOut;
  if (!checkedOutNow) return { ...result, kept: result.examined, skipped: 'worktree-list-failed' };

  for (const { branch, tip } of deletable) {
    if (checkedOutNow.has(branch)) continue;
    const del = await git(['update-ref', '-d', `refs/heads/${branch}`, tip], baseDir);
    if (del.code !== 0) continue;
    // Best effort: drop the stale `branch.<name>.*` config git branch -D would remove.
    await git(['config', '--remove-section', `branch.${branch}`], baseDir);
    result.deleted.push(branch);
  }
  result.kept = result.examined - result.deleted.length;

  if (result.deleted.length > 0) {
    logger.info(
      { deleted: result.deleted, kept: result.kept, examined: result.examined },
      `[pruneMergedLocalBranches] Deleted ${result.deleted.length} preserved local branch(es)`,
    );
  } else {
    logger.debug(
      `[pruneMergedLocalBranches] No local branch to prune (${result.examined} examined)`,
    );
  }
  return result;
}
