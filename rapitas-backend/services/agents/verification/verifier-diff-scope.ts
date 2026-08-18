/**
 * verifier-diff-scope
 *
 * Resolves the diff base ref a task's worktree branched from and lists/groups
 * the changed files (all files, code files, per-project-root grouping).
 * Contains no lint/typecheck/test logic. Extracted from automated-verifier.ts
 * (file-size split).
 */
import { existsSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { assertSafeGitRef } from '../../../utils/common/branch-name-generator';
import { CODE_EXTENSIONS, git, runCmd } from './verifier-exec';

/**
 * Resolve the fork-point this worktree branched from, so changed-file lists
 * include commits the agent made mid-run. A plain `git diff HEAD` only shows
 * UNCOMMITTED work, so once the agent commits (workflow verify phase commits
 * before this gate runs) the change set reads as empty — the scope check sees
 * nothing and lint runs on nothing, a silent false pass.
 *
 * Tries `preferredBaseBranch` FIRST — the branch this task's worktree was
 * actually cut from (`task.theme.defaultBranch`, see
 * task-resolver.ts's `resolvePreferredBaseBranch`) — before falling back to
 * the develop → main → master guess (mirrors diff-structured.ts's
 * `resolveBaseRef`, which is where this same bug was first found and fixed:
 * task 506, a stale/divergent `develop` branch made merge-base land on an
 * ancient common ancestor, pulling every commit merged into the real base
 * since into "this task's diff" — unrelated pre-existing files misread as
 * scope creep / tampering, causing false lint/typecheck/tamper-gate failures
 * on files the agent never touched). Falls back to HEAD when no base branch
 * exists.
 *
 * The guess-only fallback tries `origin/<branch>` before the bare local
 * branch name (task 511: the bare local `develop` in a worktree's shared
 * `.git` only advances via unrelated event paths — e.g. post-merge sync — and
 * can sit stale for days, while `origin/<branch>` is refreshed by any fetch
 * anywhere against the same remote).
 *
 * @param workdir - Worktree directory. / ワークツリーのディレクトリ
 * @param preferredBaseBranch - The branch this task's worktree was cut from, when known. / このタスクの分岐元ブランチ（既知の場合）
 * @returns A diffable base ref (merge-base commit or 'HEAD'). / 差分基準のref
 */
export async function diffBaseRef(
  workdir: string,
  preferredBaseBranch?: string | null,
): Promise<string> {
  // preferredBaseBranch is persisted DB data (theme.defaultBranch /
  // AgentExecutionConfig.targetBranch), not necessarily re-validated at read
  // time — re-check before it reaches a shell-interpolated git command
  // (defense-in-depth; the write path already runs assertSafeGitRef, but this
  // function must not trust that blindly).
  let safePreferred: string | null = null;
  if (preferredBaseBranch) {
    try {
      assertSafeGitRef(preferredBaseBranch, 'preferredBaseBranch');
      safePreferred = preferredBaseBranch;
    } catch {
      // Unsafe/malformed value — ignore it and fall through to the heuristic.
    }
  }
  // Per branch NAME, try origin/<name> AND local <name>, then keep the NEWER
  // of the two merge-bases — that is the true fork point. Preferring origin
  // unconditionally (the task-511 fix for a stale local branch) breaks the
  // mirrored case: a local-first repo accumulates UNPUSHED commits on the base
  // branch, merge-base against origin lands BEFORE them, and every unpushed
  // commit bleeds into "this task's diff" (observed as "36/37 files are
  // unrelated" adversarial-review rejections). Mirrors diff-structured.ts.
  const groups = [
    ...(safePreferred ? [[`origin/${safePreferred}`, safePreferred]] : []),
    ['origin/develop', 'develop'],
    ['origin/main', 'main'],
    ['origin/master', 'master'],
  ];
  for (const group of groups) {
    const bases: string[] = [];
    for (const candidate of group) {
      const base = (await git(workdir, `merge-base HEAD ${candidate}`)).trim();
      if (base && !bases.includes(base)) bases.push(base);
    }
    if (bases.length === 1) return bases[0]!;
    if (bases.length === 2) {
      // Exit 0 = bases[0] is an ancestor of bases[1] → bases[1] is newer.
      // On divergence (neither is an ancestor) keep origin's base (task 511).
      const rel = await runCmd(`git merge-base --is-ancestor ${bases[0]} ${bases[1]}`, workdir);
      return rel.code === 0 ? bases[1]! : bases[0]!;
    }
  }
  return 'HEAD';
}

/**
 * Lists EVERY changed path in the worktree (any file type, including
 * deletions) for the plan-scope check — out-of-plan deletions and non-code
 * edits are scope violations too.
 */
export async function getAllChangedFiles(
  workdir: string,
  preferredBaseBranch?: string | null,
): Promise<string[]> {
  const base = await diffBaseRef(workdir, preferredBaseBranch);
  const tracked = await git(workdir, `diff ${base} --name-only --diff-filter=ACMRD`);
  const untracked = await git(workdir, 'ls-files --others --exclude-standard');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of `${tracked}\n${untracked}`.split('\n')) {
    const f = line.trim();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}

/**
 * Lists the agent's added/modified code files (repo-relative), excluding
 * deletions and non-code files.
 */
export async function getChangedCodeFiles(
  workdir: string,
  preferredBaseBranch?: string | null,
): Promise<string[]> {
  // ACMR = added/copied/modified/renamed — excludes deletions (nothing to lint).
  // Base = fork-point (not HEAD) so files in the agent's mid-run commits are linted.
  const base = await diffBaseRef(workdir, preferredBaseBranch);
  const tracked = await git(workdir, `diff ${base} --name-only --diff-filter=ACMR`);
  const untracked = await git(workdir, 'ls-files --others --exclude-standard');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of `${tracked}\n${untracked}`.split('\n')) {
    const f = line.trim();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    if (!CODE_EXTENSIONS.has(extname(f).toLowerCase())) continue;
    if (!existsSync(join(workdir, f))) continue;
    out.push(f);
  }
  return out;
}

/** Nearest ancestor directory (within workdir) that holds a package.json. */
function projectRootFor(workdir: string, file: string): string {
  const root = resolve(workdir);
  let dir = dirname(resolve(join(workdir, file)));
  while (dir.startsWith(root)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return root;
}

/** Groups changed files by their owning project root (for monorepos). */
export function groupByProjectRoot(workdir: string, files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const rootDir = projectRootFor(workdir, f);
    const list = groups.get(rootDir) ?? [];
    list.push(f);
    groups.set(rootDir, list);
  }
  return groups;
}
