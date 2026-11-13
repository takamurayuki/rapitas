/**
 * WorkPreserved
 *
 * One answer to "is this commit's work kept somewhere other than this
 * machine?", shared by the local-branch prune and the worktree sweep so the
 * two never disagree about what is safe to delete. Not responsible for
 * deleting anything.
 *
 * Preserved means: the tip is an ancestor of origin/develop or origin/main,
 * or an ancestor of (or equal to) the head of a MERGED/CLOSED pull request
 * from that branch — the second case covers squash merges, whose commits
 * never become ancestors of develop.
 */
import type { PullRequestHead } from '../../../../github/pr-head-lookup';

/** Outcome of one git invocation; never thrown, so "unknown" is always explicit. */
export interface GitResult {
  /** Exit code, or -1 when git could not be run or timed out. */
  code: number;
  stdout: string;
}

/** Runs git in a directory. */
export type GitRunner = (args: string[], cwd: string, timeoutMs?: number) => Promise<GitResult>;

/** Looks up the pull requests opened from a branch; null when the lookup failed. */
export type PullRequestLookup = (
  repoDir: string,
  branch: string,
) => Promise<PullRequestHead[] | null>;

/** Remote branches whose history counts as kept. */
export const PRESERVING_REFS = ['refs/remotes/origin/develop', 'refs/remotes/origin/main'];

/**
 * `git merge-base --is-ancestor`.
 *
 * @param git - Git runner / git 実行関数
 * @param baseDir - Repository root / リポジトリのルート
 * @param commit - Candidate ancestor / 祖先候補
 * @param of - Descendant ref or commit / 子孫側
 * @returns true / false, or null when git could not tell / 判定（不明は null）
 */
export async function isAncestor(
  git: GitRunner,
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
 * Whether a commit's work is preserved on the remote.
 *
 * @param git - Git runner / git 実行関数
 * @param baseDir - Repository root / リポジトリのルート
 * @param tip - The commit / 対象コミット
 * @param options.branch - Branch name, for the pull-request check; omit for a detached HEAD / ブランチ名
 * @param options.remoteRefs - Remote refs that exist after the last fetch / fetch 後に存在するリモート参照
 * @param options.lookupPrs - Pull-request lookup; omit to skip that check / PR 検索
 * @returns true only when provably preserved; false when unknown / 保存済みと証明できたときだけ true
 */
export async function isWorkPreserved(
  git: GitRunner,
  baseDir: string,
  tip: string,
  options: { branch?: string; remoteRefs: Set<string>; lookupPrs?: PullRequestLookup },
): Promise<boolean> {
  for (const ref of PRESERVING_REFS) {
    if (options.remoteRefs.has(ref) && (await isAncestor(git, baseDir, tip, ref)) === true) {
      return true;
    }
  }
  if (!options.branch || !options.lookupPrs) return false;
  const prs = await options.lookupPrs(baseDir, options.branch);
  for (const pr of prs ?? []) {
    if (pr.state !== 'MERGED' && pr.state !== 'CLOSED') continue;
    if (pr.headRefOid === tip || (await isAncestor(git, baseDir, tip, pr.headRefOid)) === true) {
      return true;
    }
  }
  return false;
}
