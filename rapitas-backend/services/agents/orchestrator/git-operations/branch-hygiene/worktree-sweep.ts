/**
 * WorktreeSweep
 *
 * Removes worktrees nobody is using any more, whoever made them: the ones
 * people, Codex and Claude Code sub-agents leave under `.worktrees/` and
 * `.claude/worktrees/`, and the temp-dir ratchet worktrees a crash leaves
 * behind. Task worktrees (`.worktrees/task-<id>-…`) stay with the
 * session-based cleanup in worktree-cleanup.ts; branches stay with
 * local-branch-prune.ts, which can delete them once their worktree is gone.
 *
 * A worktree is removed only when ALL of these hold — anything unknown keeps it:
 * - it is in a managed place (above) and is not the main checkout;
 * - it is not locked (Claude Code locks the worktree of a running agent);
 * - it has been idle for `idleMs` (HEAD commit, index and directory all older);
 * - `git status` shows nothing — no modified, staged or untracked file;
 * - its HEAD is preserved per work-preserved.ts (on origin/develop or main, or
 *   the head of a merged/closed PR from its branch).
 *
 * Links inside it (the node_modules / Prisma junctions setup-worktree.cjs
 * makes into the main checkout) are unlinked first and never followed: a
 * recursive delete through a junction empties the main checkout's
 * node_modules. If any link is left, the worktree is kept.
 */
import { execFile } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from '../../../../../config/logger';
import { isWorkPreserved, type GitRunner, type PullRequestLookup } from './work-preserved';

const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/worktree-sweep');

/** How long a worktree must sit untouched before it may go. */
export const DEFAULT_IDLE_MS = 24 * 60 * 60 * 1000;
/** Places under the repository whose worktrees this sweep owns. */
const MANAGED_ROOTS = ['.worktrees', '.claude/worktrees'];
/** Owned by the session-based cleanup, which knows whether the task still runs. */
const TASK_WORKTREE = /^task-\d+-/;
/** auto-merge-premerge-gate.ts names its throwaway worktrees like this. */
const RATCHET_TEMP = /^rapitas-ratchet-/;
/** Deep enough for rapitas-backend/generated/prisma-sqlite. */
const LINK_SEARCH_DEPTH = 4;
const GIT_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 120_000;

/** Why a worktree was kept. */
export type KeptReason =
  | 'locked'
  | 'task-owned'
  | 'outside-roots'
  | 'recent'
  | 'dirty'
  | 'unpreserved'
  | 'links-remaining'
  | 'remove-failed';

/** What one sweep did. */
export interface WorktreeSweepResult {
  examined: number;
  /** Removed worktree paths, `/`-separated. */
  removed: string[];
  kept: Array<{ path: string; reason: KeptReason }>;
  skipped?: 'fetch-failed' | 'worktree-list-failed';
}

/** Injectable collaborators and knobs. */
export interface WorktreeSweepDeps {
  git?: GitRunner;
  lookupPrs?: PullRequestLookup;
  now?: number;
  idleMs?: number;
}

interface WorktreeEntry {
  path: string;
  head: string;
  branch?: string;
  locked: boolean;
}

const slash = (p: string) => p.replace(/\\/g, '/');

async function runGit(args: string[], cwd: string, timeoutMs = GIT_TIMEOUT_MS) {
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

function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = [];
  let cur: WorktreeEntry | null = null;
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: slash(line.slice(9)), head: '', locked: false };
    } else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (cur && line.startsWith('branch '))
      cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (cur && (line === 'locked' || line.startsWith('locked '))) cur.locked = true;
  }
  if (cur) out.push(cur);
  return out;
}

function placeOf(path: string, baseDir: string): 'managed' | 'task' | 'temp' | 'outside' {
  const base = slash(resolve(baseDir));
  for (const root of MANAGED_ROOTS) {
    const prefix = `${base}/${root}/`;
    if (path.startsWith(prefix)) {
      const name = path.slice(prefix.length).split('/')[0] ?? '';
      if (path.slice(prefix.length).includes('/')) return 'outside';
      return root === '.worktrees' && TASK_WORKTREE.test(name) ? 'task' : 'managed';
    }
  }
  const temp = `${slash(resolve(tmpdir()))}/`;
  if (path.startsWith(temp) && RATCHET_TEMP.test(basename(path))) return 'temp';
  return 'outside';
}

/** Newest of the directory, its admin index and HEAD's commit time, in ms. */
async function lastTouched(git: GitRunner, entry: WorktreeEntry): Promise<number> {
  const times: number[] = [];
  try {
    times.push(statSync(entry.path).mtimeMs);
    const dotGit = join(entry.path, '.git');
    const gitdir = readFileSync(dotGit, 'utf8')
      .match(/^gitdir:\s*(.+)$/m)?.[1]
      ?.trim();
    if (gitdir) {
      const admin = isAbsolute(gitdir) ? gitdir : resolve(entry.path, gitdir);
      for (const f of ['index', 'HEAD']) {
        if (existsSync(join(admin, f))) times.push(statSync(join(admin, f)).mtimeMs);
      }
    }
  } catch {
    // An unreadable worktree counts as touched now, so it is kept.
    return Number.POSITIVE_INFINITY;
  }
  const committed = await git(['log', '-1', '--format=%ct', 'HEAD'], entry.path);
  if (committed.code === 0) times.push(Number(committed.stdout.trim()) * 1000);
  return Math.max(...times);
}

/**
 * Remove a link itself, never what it points at.
 *
 * NOTE: unlinkSync is what setup-worktree.cjs uses (under node). Under bun a
 * Windows directory junction can refuse unlink, and rmSync fails with EFAULT
 * on it; rmdirSync without `recursive` removes the junction entry only.
 */
function unlinkOnly(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    try {
      rmdirSync(p);
    } catch {
      /* left in place; hasLinks() then keeps the worktree */
    }
  }
}

/** Unlink every symlink / junction under `dir` without following any. */
function unlinkLinks(dir: string, depth = 0): void {
  if (depth > LINK_SEARCH_DEPTH) return;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (depth === 0 && name === '.git') continue;
    const p = join(dir, name);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      unlinkOnly(p);
    } else if (st.isDirectory()) {
      unlinkLinks(p, depth + 1);
    }
  }
}

function hasLinks(dir: string, depth = 0): boolean {
  if (depth > LINK_SEARCH_DEPTH) return false;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    const p = join(dir, name);
    try {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) return true;
      if (st.isDirectory() && !(depth === 0 && name === '.git') && hasLinks(p, depth + 1)) {
        return true;
      }
    } catch {
      /* unreadable entry: ignore */
    }
  }
  return false;
}

/**
 * Remove idle, clean, preserved worktrees (see the module header for the rules).
 *
 * @param baseDir - Main repository root / メインリポジトリのルート
 * @param deps - Overrides for tests / テスト用の差し替え
 * @returns What was removed and why the rest were kept / 削除結果と残した理由
 */
export async function sweepIdleWorktrees(
  baseDir: string,
  deps: WorktreeSweepDeps = {},
): Promise<WorktreeSweepResult> {
  const git = deps.git ?? runGit;
  const lookupPrs =
    deps.lookupPrs ??
    (async (dir: string, branch: string) => {
      const { listPullRequestsForHead } = await import('../../../../github/pr-head-lookup');
      return listPullRequestsForHead(dir, branch);
    });
  const now = deps.now ?? Date.now();
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
  const result: WorktreeSweepResult = { examined: 0, removed: [], kept: [] };

  // "Preserved on the remote" is only true against a fresh view of it.
  if (
    (await git(['fetch', '--prune', '--quiet', 'origin'], baseDir, FETCH_TIMEOUT_MS)).code !== 0
  ) {
    return { ...result, skipped: 'fetch-failed' };
  }
  const list = await git(['worktree', 'list', '--porcelain'], baseDir);
  if (list.code !== 0) return { ...result, skipped: 'worktree-list-failed' };
  const remotes = await git(['for-each-ref', '--format=%(refname)', 'refs/remotes/'], baseDir);
  const remoteRefs = new Set(remotes.stdout.split(/\r?\n/).filter(Boolean));

  // The first entry is always the main checkout.
  for (const entry of parseWorktrees(list.stdout).slice(1)) {
    result.examined++;
    const keep = (reason: KeptReason) => result.kept.push({ path: entry.path, reason });
    const place = placeOf(entry.path, baseDir);
    if (place === 'outside') {
      keep('outside-roots');
      continue;
    }
    if (place === 'task') {
      keep('task-owned');
      continue;
    }
    if (entry.locked) {
      keep('locked');
      continue;
    }
    if (now - (await lastTouched(git, entry)) < idleMs) {
      keep('recent');
      continue;
    }
    const status = await git(['status', '--porcelain', '--untracked-files=normal'], entry.path);
    if (status.code !== 0 || status.stdout.trim() !== '') {
      keep('dirty');
      continue;
    }
    const preserved =
      !!entry.head &&
      (await isWorkPreserved(git, baseDir, entry.head, {
        remoteRefs,
        ...(entry.branch ? { branch: entry.branch, lookupPrs } : {}),
      }));
    if (!preserved) {
      keep('unpreserved');
      continue;
    }

    unlinkLinks(entry.path);
    if (hasLinks(entry.path)) {
      keep('links-remaining');
      continue;
    }
    const removed = await git(['worktree', 'remove', '--force', entry.path], baseDir);
    if (removed.code !== 0 && existsSync(entry.path)) {
      // git refuses on a locked file; the directory is link-free, so a plain delete is safe.
      try {
        rmSync(entry.path, { recursive: true, force: true });
      } catch {
        /* checked below */
      }
    }
    await git(['worktree', 'prune'], baseDir);
    if (existsSync(entry.path)) {
      keep('remove-failed');
      continue;
    }
    result.removed.push(entry.path);
  }

  if (result.removed.length > 0) {
    logger.info(
      { removed: result.removed, kept: result.kept.length },
      `[sweepIdleWorktrees] Removed ${result.removed.length} idle worktree(s)`,
    );
  }
  return result;
}
