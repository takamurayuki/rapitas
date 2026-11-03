/**
 * PrHeadLookup
 *
 * Read-only lookup of the pull requests opened from one branch: their state
 * and head commit. Used by the worktree/branch cleanup sweeps to decide
 * whether a branch is still the target of an open PR, or whether its tip is
 * already preserved by a merged/closed one.
 * Not responsible for deciding what may be deleted — callers own that.
 */

import { runGhCommand } from './gh-client';
import { ownerRepoFromGitRemote } from './git-exec';
import { toOwnerRepoString, type OwnerRepo } from './owner-repo';

/** One PR opened from the branch that was asked about. */
export interface PullRequestHead {
  number: number;
  /** As gh reports it: OPEN, CLOSED or MERGED. */
  state: string;
  headRefName: string;
  /** The PR's head commit — GitHub keeps it reachable via refs/pull/<n>/head. */
  headRefOid: string;
}

/** Injectable collaborators, so callers' tests need no module mocks. */
export interface PrHeadLookupDeps {
  resolveRepo: (repoDir: string) => Promise<OwnerRepo | null>;
  gh: (args: string[]) => Promise<string>;
}

const defaultDeps: PrHeadLookupDeps = {
  resolveRepo: ownerRepoFromGitRemote,
  gh: (args) => runGhCommand(args, undefined, { skipLog: true }),
};

/** A branch rarely has more than a handful of PRs; this only bounds a pathological one. */
const MAX_PRS_PER_HEAD = 50;

const isPullRequestHead = (v: unknown): v is PullRequestHead => {
  const r = v as Partial<PullRequestHead> | null;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.number === 'number' &&
    typeof r.state === 'string' &&
    typeof r.headRefName === 'string' &&
    typeof r.headRefOid === 'string'
  );
};

/**
 * List the PRs (any state) whose head is exactly `branch`.
 *
 * @param repoDir - Local checkout whose `origin` names the GitHub repo / origin を持つローカルチェックアウト
 * @param branch - Head branch name / ヘッドブランチ名
 * @param deps - Overrides for tests / テスト用の差し替え
 * @returns The PRs, `[]` when there are none, or null when GitHub could not be asked or answered unreadably — callers must treat null as "unknown" and keep / PR一覧。問い合わせ不能なら null（呼び出し側は「不明=残す」）
 */
export async function listPullRequestsForHead(
  repoDir: string,
  branch: string,
  deps: PrHeadLookupDeps = defaultDeps,
): Promise<PullRequestHead[] | null> {
  try {
    const repo = await deps.resolveRepo(repoDir);
    if (!repo) return null;
    const output = await deps.gh([
      'pr',
      'list',
      '--repo',
      toOwnerRepoString(repo),
      '--head',
      branch,
      '--state',
      'all',
      '--limit',
      String(MAX_PRS_PER_HEAD),
      '--json',
      'number,state,headRefName,headRefOid',
    ]);
    if (!output.trim()) return [];
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed) || !parsed.every(isPullRequestHead)) return null;
    // gh's --head filter is a branch-name match; keep exact matches only.
    return parsed.filter((pr) => pr.headRefName === branch);
  } catch {
    return null;
  }
}
