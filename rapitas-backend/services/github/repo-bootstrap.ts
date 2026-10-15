/**
 * GitHub Repository Bootstrap
 *
 * One-click git bootstrap for a theme's working directory: repository
 * initialization with a GitHub remote (git init → initial commit → gh repo
 * create --push) and local+remote branch creation, idempotent at every step
 * (already-done steps are skipped and reported false). Not responsible for
 * persisting the resulting repositoryUrl onto the theme — callers do that.
 */

import { stat, readdir, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { createLogger } from '../../config/logger';
import { runGitCommand, clearGitRemoteCache } from './git-exec';
import { runGhCommand, isGhAvailable, isAuthenticated } from './gh-client';
import { parseOwnerRepo } from './owner-repo';

const log = createLogger('github-service:repo-bootstrap');

/** Machine-readable failure category for the init-repository API contract. */
export type InitRepositoryErrorCode =
  | 'path_not_found'
  | 'gh_unavailable'
  | 'gh_unauthenticated'
  | 'remote_mismatch'
  | 'git_failed'
  | 'gh_failed';

/** Which bootstrap steps were performed now (true) vs already done/skipped (false). */
export interface InitRepositorySteps {
  /** `git init -b <defaultBranch>` was executed. */
  gitInit: boolean;
  /** An initial commit was created (including the optional README seed). */
  initialCommit: boolean;
  /** A new GitHub repository was created via `gh repo create`. */
  repoCreated: boolean;
  /** The local branch was pushed to the new remote. */
  pushed: boolean;
}

/** Request parameters for {@link initRepository}. */
export interface InitRepositoryRequest {
  /** Absolute path of the working directory to bootstrap. */
  path: string;
  /** Repository name; defaults to basename(path), sanitized to [A-Za-z0-9._-]. */
  repoName?: string;
  /** GitHub repository visibility; defaults to 'private'. */
  visibility?: 'private' | 'public';
  /** Initial branch name for `git init -b`; defaults to 'develop'. */
  defaultBranch?: string;
}

/** Successful bootstrap outcome. */
export interface InitRepositorySuccess {
  success: true;
  /** Canonical https://github.com/<owner>/<repo> URL (no .git suffix). */
  repositoryUrl: string;
  /** Current local branch after bootstrap. */
  branch: string;
  /** Per-step performed/skipped flags. */
  steps: InitRepositorySteps;
}

/** Failed bootstrap outcome. */
export interface InitRepositoryFailure {
  success: false;
  /** Human-readable error message. */
  error: string;
  /** Machine-readable error category. */
  code: InitRepositoryErrorCode;
}

/** Discriminated union returned by {@link initRepository}. */
export type InitRepositoryResult = InitRepositorySuccess | InitRepositoryFailure;

/**
 * Sanitize a raw repository name to GitHub's allowed charset [A-Za-z0-9._-].
 *
 * @param raw - Raw name (e.g. directory basename) / 元の名前（ディレクトリ名など）
 * @returns Sanitized repository name / サニタイズ済みリポジトリ名
 */
export function sanitizeRepoName(raw: string): string {
  return (
    raw
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .replace(/-{2,}/g, '-')
      // NOTE: leading '-' would be parsed as a flag by gh; trailing '-' is noise.
      .replace(/^-+/, '')
      .replace(/-+$/, '')
  );
}

function fail(code: InitRepositoryErrorCode, error: string): InitRepositoryFailure {
  return { success: false, error, code };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Create the initial commit, retrying with a fallback identity when the repo
 * (and global config) has no user.name/user.email configured.
 *
 * @param dirPath - Repository working directory / リポジトリの作業ディレクトリ
 * @throws {Error} When the commit fails for a non-identity reason / identity以外の理由で失敗した場合
 */
async function commitWithIdentityFallback(dirPath: string): Promise<void> {
  try {
    await runGitCommand(['commit', '-m', 'chore: initial commit'], dirPath, { skipLog: true });
  } catch (err) {
    const msg = messageOf(err);
    // NOTE: git reports missing identity as "Please tell me who you are" /
    // "empty ident" / hints mentioning user.name/user.email — only then retry
    // with the rapitas fallback identity so a configured identity always wins.
    if (/Please tell me who you are|empty ident|user\.name|user\.email/i.test(msg)) {
      await runGitCommand(
        [
          '-c',
          'user.name=rapitas',
          '-c',
          'user.email=rapitas@local',
          'commit',
          '-m',
          'chore: initial commit',
        ],
        dirPath,
      );
      return;
    }
    throw err;
  }
}

/**
 * Resolve the current local branch name, falling back when HEAD is unborn/detached.
 *
 * @param dirPath - Repository working directory / リポジトリの作業ディレクトリ
 * @param fallback - Branch name to return on failure / 解決失敗時に返すブランチ名
 * @returns Branch name / ブランチ名
 */
async function resolveBranch(dirPath: string, fallback: string): Promise<string> {
  const branch = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], dirPath, {
    skipLog: true,
  }).catch(() => null);
  return branch && branch !== 'HEAD' ? branch : fallback;
}

/**
 * Resolve the canonical https URL of the repository behind `origin`.
 * Prefers `gh repo view --json url`; falls back to parsing the remote URL.
 *
 * @param dirPath - Repository working directory / リポジトリの作業ディレクトリ
 * @returns https://github.com/<owner>/<repo> URL, or null when unresolvable / 解決不能ならnull
 */
async function resolveRepositoryUrl(dirPath: string): Promise<string | null> {
  try {
    const out = await runGhCommand(['repo', 'view', '--json', 'url'], dirPath, { skipLog: true });
    const parsed = JSON.parse(out) as { url?: string };
    if (parsed.url) return parsed.url.replace(/\.git$/, '');
  } catch {
    // NOTE: gh repo view can fail right after creation (eventual consistency)
    // or in tests — the remote URL parse below is an equivalent source.
  }
  const remote = await runGitCommand(['remote', 'get-url', 'origin'], dirPath, {
    skipLog: true,
  }).catch(() => null);
  const ownerRepo = remote ? parseOwnerRepo(remote) : null;
  return ownerRepo ? `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}` : null;
}

/**
 * Bootstrap a working directory into a git repository with a GitHub remote.
 * Every step is idempotent: existing repos, commits, and remotes are detected
 * and skipped, with `steps` reporting what was actually performed.
 *
 * @param req - Path plus optional repoName/visibility/defaultBranch / パスと任意のリポジトリ設定
 * @returns Success with repositoryUrl/branch/steps, or a coded failure / 成否と詳細
 */
export async function initRepository(req: InitRepositoryRequest): Promise<InitRepositoryResult> {
  const dirPath = req.path;
  const visibility = req.visibility ?? 'private';
  const defaultBranch = req.defaultBranch?.trim() || 'develop';
  const repoName = sanitizeRepoName(req.repoName?.trim() || basename(dirPath));
  const steps: InitRepositorySteps = {
    gitInit: false,
    initialCommit: false,
    repoCreated: false,
    pushed: false,
  };

  // a. Path must exist and be a directory.
  const dirStat = await stat(dirPath).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) {
    return fail(
      'path_not_found',
      `指定されたパスが存在しないかディレクトリではありません: ${dirPath}`,
    );
  }

  // b. gh CLI must be installed and authenticated.
  if (!(await isGhAvailable())) {
    return fail('gh_unavailable', 'GitHub CLI (gh) が見つかりません。インストールしてください。');
  }
  if (!(await isAuthenticated())) {
    return fail(
      'gh_unauthenticated',
      'GitHub CLI が未認証です。`gh auth login` を実行してください。',
    );
  }

  if (!/[A-Za-z0-9]/.test(repoName)) {
    return fail(
      'gh_failed',
      `有効なリポジトリ名を生成できませんでした: ${req.repoName ?? basename(dirPath)}`,
    );
  }

  // c. git init when the directory is not yet a repository.
  // NOTE: stat (not isDirectory) — in a worktree `.git` is a file, still a repo.
  const gitEntry = await stat(join(dirPath, '.git')).catch(() => null);
  if (!gitEntry) {
    try {
      await runGitCommand(['init', '-b', defaultBranch], dirPath);
      steps.gitInit = true;
    } catch (err) {
      return fail('git_failed', `git init に失敗しました: ${messageOf(err)}`);
    }
  }

  // d. Seed an initial commit when the repo has no commits yet.
  const hasCommits = await runGitCommand(['rev-parse', '--verify', 'HEAD'], dirPath, {
    skipLog: true,
  }).then(
    () => true,
    () => false,
  );
  if (!hasCommits) {
    try {
      const entries = (await readdir(dirPath)).filter((name) => name !== '.git');
      if (entries.length === 0) {
        // NOTE: gh repo create --push needs at least one tracked file to push.
        await writeFile(join(dirPath, 'README.md'), `# ${repoName}\n`, 'utf8');
      }
      await runGitCommand(['add', '-A'], dirPath);
      await commitWithIdentityFallback(dirPath);
      steps.initialCommit = true;
    } catch (err) {
      return fail('git_failed', `初期コミットの作成に失敗しました: ${messageOf(err)}`);
    }
  }

  // e. Existing origin remote → return its URL without creating anything.
  const existingRemote = await runGitCommand(['remote', 'get-url', 'origin'], dirPath, {
    skipLog: true,
  }).catch(() => null);
  if (existingRemote) {
    const ownerRepo = parseOwnerRepo(existingRemote);
    if (!ownerRepo) {
      return fail(
        'remote_mismatch',
        `originリモートがGitHubのURLではありません: ${existingRemote}`,
      );
    }
    return {
      success: true,
      repositoryUrl: `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}`,
      branch: await resolveBranch(dirPath, defaultBranch),
      steps,
    };
  }

  // f. Create the GitHub repository, wiring it as origin and pushing.
  try {
    await runGhCommand(
      [
        'repo',
        'create',
        repoName,
        `--${visibility}`,
        `--source=${dirPath}`,
        '--remote=origin',
        '--push',
      ],
      dirPath,
    );
    steps.repoCreated = true;
    steps.pushed = true;
  } catch (err) {
    return fail('gh_failed', `GitHubリポジトリの作成に失敗しました: ${messageOf(err)}`);
  }

  // NOTE: origin was just added — drop any stale "no remote" cache entry.
  clearGitRemoteCache(dirPath);

  // g. Resolve the canonical URL of the repository we just created.
  const repositoryUrl = await resolveRepositoryUrl(dirPath);
  if (!repositoryUrl) {
    return fail('gh_failed', '作成したリポジトリのURLを解決できませんでした');
  }

  const branch = await resolveBranch(dirPath, defaultBranch);
  log.info({ dirPath, repositoryUrl, branch, steps }, 'repository bootstrap completed');
  return { success: true, repositoryUrl, branch, steps };
}

// ─── Branch Creation ─────────────────────────────────────────────────────────

/** Machine-readable failure category for the create-branch API contract. */
export type CreateBranchErrorCode =
  | 'path_not_found'
  | 'not_a_repo'
  | 'invalid_branch_name'
  | 'no_remote'
  | 'git_failed';

/** Which branch-creation steps were performed now (true) vs already done/skipped (false). */
export interface CreateBranchSteps {
  /** A new local branch was created (false = it already existed). */
  created: boolean;
  /** The branch was pushed to origin (false = already on the remote, or no remote). */
  pushed: boolean;
}

/** Request parameters for {@link createBranch}. */
export interface CreateBranchRequest {
  /** Absolute path of the git repository working directory. */
  path: string;
  /** Branch name to create locally and on the remote. */
  branchName: string;
  /** Base ref to branch from; defaults to the current HEAD. */
  baseBranch?: string;
}

/** Successful branch-creation outcome. */
export interface CreateBranchSuccess {
  success: true;
  /** The created (or pre-existing) branch name. */
  branch: string;
  /** Per-step performed/skipped flags. */
  steps: CreateBranchSteps;
}

/** Failed branch-creation outcome. */
export interface CreateBranchFailure {
  success: false;
  /** Human-readable error message. */
  error: string;
  /** Machine-readable error category. */
  code: CreateBranchErrorCode;
}

/** Discriminated union returned by {@link createBranch}. */
export type CreateBranchResult = CreateBranchSuccess | CreateBranchFailure;

function failBranch(code: CreateBranchErrorCode, error: string): CreateBranchFailure {
  return { success: false, error, code };
}

/**
 * Validate a branch name via `git check-ref-format --branch` (argv array —
 * the injection-safe validation; no shell is ever involved).
 *
 * @param dirPath - Repository working directory / リポジトリの作業ディレクトリ
 * @param name - Candidate branch name / 検証するブランチ名
 * @returns true when the name is a valid branch name / 有効なブランチ名かどうか
 */
async function isValidBranchName(dirPath: string, name: string): Promise<boolean> {
  // NOTE: a leading '-' would be parsed by git as an option, not a ref name.
  if (!name || name.startsWith('-')) return false;
  return runGitCommand(['check-ref-format', '--branch', name], dirPath, { skipLog: true }).then(
    () => true,
    () => false,
  );
}

/**
 * Create a branch locally and push it to origin, idempotently. Never checks
 * the branch out — the caller's current working branch must not change.
 * A repository without an origin remote is a non-fatal state: the branch is
 * created locally and `steps.pushed` stays false.
 *
 * @param req - Path, branchName, and optional baseBranch / パス・ブランチ名・任意のベースブランチ
 * @returns Success with branch/steps, or a coded failure / 成否と詳細
 */
export async function createBranch(req: CreateBranchRequest): Promise<CreateBranchResult> {
  const dirPath = req.path;
  const branchName = req.branchName.trim();
  const steps: CreateBranchSteps = { created: false, pushed: false };

  // 1. Path must exist, be a directory, and be a git repository.
  const dirStat = await stat(dirPath).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) {
    return failBranch(
      'path_not_found',
      `指定されたパスが存在しないかディレクトリではありません: ${dirPath}`,
    );
  }
  // NOTE: stat (not isDirectory) — in a worktree `.git` is a file, still a repo.
  const gitEntry = await stat(join(dirPath, '.git')).catch(() => null);
  if (!gitEntry) {
    return failBranch('not_a_repo', `gitリポジトリではありません: ${dirPath}`);
  }

  // 2. Branch name validation via git itself.
  if (!(await isValidBranchName(dirPath, branchName))) {
    return failBranch('invalid_branch_name', `無効なブランチ名です: ${req.branchName}`);
  }

  // 3. Resolve the base ref when given: local branch first, then origin/<base>.
  let base: string | undefined;
  if (req.baseBranch?.trim()) {
    const rawBase = req.baseBranch.trim();
    if (!(await isValidBranchName(dirPath, rawBase))) {
      return failBranch('invalid_branch_name', `無効なベースブランチ名です: ${req.baseBranch}`);
    }
    for (const candidate of [rawBase, `origin/${rawBase}`]) {
      const resolved = await runGitCommand(['rev-parse', '--verify', candidate], dirPath, {
        skipLog: true,
      }).then(
        () => true,
        () => false,
      );
      if (resolved) {
        base = candidate;
        break;
      }
    }
    if (!base) {
      return failBranch('git_failed', `ベースブランチを解決できませんでした: ${rawBase}`);
    }
  }

  // 4. Create the local branch unless it already exists. Deliberately `git
  // branch`, never checkout/switch — the primary checkout's current branch
  // must not change (hard requirement).
  const localExists = await runGitCommand(
    ['rev-parse', '--verify', `refs/heads/${branchName}`],
    dirPath,
    { skipLog: true },
  ).then(
    () => true,
    () => false,
  );
  if (!localExists) {
    try {
      await runGitCommand(base ? ['branch', branchName, base] : ['branch', branchName], dirPath);
      steps.created = true;
    } catch (err) {
      return failBranch('git_failed', `ブランチの作成に失敗しました: ${messageOf(err)}`);
    }
  }

  // 5. Push to origin when it exists and the branch is not on the remote yet.
  const remote = await runGitCommand(['remote', 'get-url', 'origin'], dirPath, {
    skipLog: true,
  }).catch(() => null);
  if (remote) {
    // NOTE: ls-remote exits 0 with empty stdout when the branch is absent; a
    // failed lookup (network) falls through to push, which reports its own error.
    const onRemote = await runGitCommand(['ls-remote', '--heads', 'origin', branchName], dirPath, {
      skipLog: true,
    })
      .then((out) => out.trim().length > 0)
      .catch(() => false);
    if (!onRemote) {
      try {
        await runGitCommand(['push', '-u', 'origin', `${branchName}:${branchName}`], dirPath);
        steps.pushed = true;
      } catch (err) {
        return failBranch('git_failed', `ブランチのpushに失敗しました: ${messageOf(err)}`);
      }
    }
  }

  log.info({ dirPath, branchName, base, steps }, 'branch creation completed');
  return { success: true, branch: branchName, steps };
}
