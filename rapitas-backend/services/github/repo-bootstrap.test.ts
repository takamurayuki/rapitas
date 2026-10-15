/**
 * repo-bootstrap.test
 *
 * Verifies the idempotent repository bootstrap flow: fresh directory
 * (init + README + commit + gh repo create --push), already-a-repo with an
 * existing remote (URL returned, nothing created), ssh remote normalization,
 * non-github remote rejection, gh auth failures, and the commit identity
 * fallback. Also covers createBranch: local+remote creation, already-exists
 * skips, name validation, and remote-less local-only creation.
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { join } from 'path';
import type { Stats } from 'fs';
import * as realFsPromises from 'fs/promises';
import { parseOwnerRepo } from './owner-repo';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

const TEST_DIR = join('C:', 'projects-fixture', 'my-project');
const DOT_GIT = join(TEST_DIR, '.git');
const README = join(TEST_DIR, 'README.md');

interface TestState {
  dirExists: boolean;
  hasDotGit: boolean;
  dirFiles: string[];
  headExists: boolean;
  remoteUrl: string | null;
  currentBranch: string | null;
  ghAvailable: boolean;
  ghAuthed: boolean;
  commitNeedsIdentity: boolean;
  repoCreateError: string | null;
  localBranches: string[];
  resolvableRefs: string[];
  remoteBranches: string[];
}

const state: TestState = {} as TestState;
const gitCalls: string[][] = [];
const ghCalls: string[][] = [];
const writtenFiles: Array<{ path: string; content: string }> = [];

function resetState(): void {
  Object.assign(state, {
    dirExists: true,
    hasDotGit: false,
    dirFiles: [],
    headExists: false,
    remoteUrl: null,
    currentBranch: null,
    ghAvailable: true,
    ghAuthed: true,
    commitNeedsIdentity: false,
    repoCreateError: null,
    localBranches: [],
    resolvableRefs: [],
    remoteBranches: [],
  } satisfies TestState);
  gitCalls.length = 0;
  ghCalls.length = 0;
  writtenFiles.length = 0;
}
resetState();

const fakeStat = { isDirectory: () => true } as unknown as Stats;
const enoent = () =>
  Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });

// ─── fs/promises mock (spread real module to mirror ALL runtime exports) ────
mock.module('fs/promises', () => ({
  ...realFsPromises,
  stat: mock((p: string | URL) => {
    const pathStr = String(p);
    if (pathStr === TEST_DIR) {
      return state.dirExists ? Promise.resolve(fakeStat) : Promise.reject(enoent());
    }
    if (pathStr === DOT_GIT) {
      return state.hasDotGit ? Promise.resolve(fakeStat) : Promise.reject(enoent());
    }
    return Promise.reject(enoent());
  }),
  readdir: mock(() => Promise.resolve([...state.dirFiles])),
  writeFile: mock((p: string | URL, content: string) => {
    writtenFiles.push({ path: String(p), content });
    state.dirFiles.push('README.md');
    return Promise.resolve();
  }),
}));

// ─── git-exec mock (mirror ALL runtime exports) ──────────────────────────────
function gitDispatch(args: string[]): Promise<string> {
  gitCalls.push(args);
  if (args[0] === 'init') {
    state.hasDotGit = true;
    state.currentBranch = args[1] === '-b' ? args[2] : 'master';
    return Promise.resolve('');
  }
  if (args[0] === 'rev-parse' && args[1] === '--verify') {
    const ref = args[2] ?? '';
    if (ref === 'HEAD') {
      return state.headExists
        ? Promise.resolve('abc1234')
        : Promise.reject(new Error('fatal: Needed a single revision'));
    }
    if (ref.startsWith('refs/heads/')) {
      return state.localBranches.includes(ref.slice('refs/heads/'.length))
        ? Promise.resolve('def5678')
        : Promise.reject(new Error('fatal: Needed a single revision'));
    }
    return state.resolvableRefs.includes(ref)
      ? Promise.resolve('aaa1111')
      : Promise.reject(new Error('fatal: Needed a single revision'));
  }
  if (args[0] === 'check-ref-format') {
    const name = args[2] ?? '';
    // Mimics git: reject whitespace, control refspec chars, and '..'.
    return /[\s~^:?*[\]\\]|\.\./.test(name)
      ? Promise.reject(new Error(`fatal: '${name}' is not a valid branch name`))
      : Promise.resolve(name);
  }
  if (args[0] === 'branch') {
    state.localBranches.push(args[1]);
    return Promise.resolve('');
  }
  if (args[0] === 'ls-remote') {
    const name = args[3] ?? '';
    // NOTE: real ls-remote exits 0 with empty stdout when the ref is absent.
    return state.remoteBranches.includes(name)
      ? Promise.resolve(`999e888\trefs/heads/${name}`)
      : Promise.resolve('');
  }
  if (args[0] === 'push') {
    return Promise.resolve('');
  }
  if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) {
    return state.currentBranch
      ? Promise.resolve(state.currentBranch)
      : Promise.reject(new Error('fatal: ambiguous argument HEAD'));
  }
  if (args[0] === 'add') return Promise.resolve('');
  if (args[0] === 'commit') {
    if (state.commitNeedsIdentity) {
      return Promise.reject(
        new Error('Please tell me who you are.\n  git config --global user.email ...'),
      );
    }
    state.headExists = true;
    return Promise.resolve('');
  }
  if (args[0] === '-c' && args.includes('commit')) {
    state.headExists = true;
    return Promise.resolve('');
  }
  if (args[0] === 'remote' && args[1] === 'get-url') {
    return state.remoteUrl
      ? Promise.resolve(state.remoteUrl)
      : Promise.reject(new Error("error: No such remote 'origin'"));
  }
  return Promise.reject(new Error(`unexpected git args: ${args.join(' ')}`));
}

mock.module('./git-exec', () => ({
  parseOwnerRepo,
  clearGitRemoteCache: mock(() => {}),
  clearAllGitRemoteCache: mock(() => {}),
  getGitRemoteCacheStats: mock(() => ({
    hits: 0,
    misses: 0,
    expiries: 0,
    total: 0,
    hitRate: 0,
    expiryRate: 0,
    size: 0,
  })),
  resetGitRemoteCacheStats: mock(() => {}),
  classifyGitError: mock(() => 'unrecoverable'),
  GIT_READ_RETRY_POLICY: { retryOn: ['transient'], maxRetries: 2, baseDelay: 500, maxDelay: 8000 },
  GIT_WRITE_RETRY_POLICY: { retryOn: [], maxRetries: 0, baseDelay: 1000, maxDelay: 8000 },
  runGitCommand: mock((args: string[]) => gitDispatch(args)),
  runGitCommandWithRetry: mock((args: string[]) => gitDispatch(args)),
  ownerRepoFromGitRemote: mock(() => Promise.resolve(null)),
}));

// ─── gh-client mock (mirror ALL runtime exports) ─────────────────────────────
function ghDispatch(args: string[]): Promise<string> {
  ghCalls.push(args);
  if (args[0] === 'repo' && args[1] === 'create') {
    if (state.repoCreateError) return Promise.reject(new Error(state.repoCreateError));
    state.remoteUrl = `https://github.com/rapitas-owner/${args[2]}.git`;
    state.headExists = true;
    return Promise.resolve(`https://github.com/rapitas-owner/${args[2]}`);
  }
  if (args[0] === 'repo' && args[1] === 'view') {
    const ownerRepo = state.remoteUrl ? parseOwnerRepo(state.remoteUrl) : null;
    if (!ownerRepo) return Promise.reject(new Error('no repository found'));
    return Promise.resolve(
      JSON.stringify({ url: `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}` }),
    );
  }
  return Promise.reject(new Error(`unexpected gh args: ${args.join(' ')}`));
}

mock.module('./gh-client', () => ({
  runGhCommand: mock((args: string[]) => ghDispatch(args)),
  runGhCommandWithRetry: mock((args: string[]) => ghDispatch(args)),
  runGhCommandWithBody: mock(() => Promise.resolve('')),
  isGhAvailable: mock(() => Promise.resolve(state.ghAvailable)),
  isAuthenticated: mock(() => Promise.resolve(state.ghAuthed)),
  listRepositories: mock(() => Promise.resolve([])),
}));

const { initRepository, createBranch, sanitizeRepoName } = await import('./repo-bootstrap');

beforeEach(() => {
  resetState();
});

describe('initRepository — fresh directory', () => {
  test('empty non-repo dir: init + README + commit + gh repo create --push', async () => {
    const result = await initRepository({ path: TEST_DIR });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.steps).toEqual({
      gitInit: true,
      initialCommit: true,
      repoCreated: true,
      pushed: true,
    });
    expect(result.repositoryUrl).toBe('https://github.com/rapitas-owner/my-project');
    expect(result.branch).toBe('develop');

    // git init used the default branch, no shell strings anywhere.
    expect(gitCalls).toContainEqual(['init', '-b', 'develop']);
    // Empty dir was seeded with a README before the initial commit.
    expect(writtenFiles).toEqual([{ path: README, content: '# my-project\n' }]);
    expect(ghCalls).toContainEqual([
      'repo',
      'create',
      'my-project',
      '--private',
      `--source=${TEST_DIR}`,
      '--remote=origin',
      '--push',
    ]);
  });

  test('non-empty dir gets no README seed', async () => {
    state.dirFiles = ['index.ts'];

    const result = await initRepository({ path: TEST_DIR, visibility: 'public' });

    expect(result.success).toBe(true);
    expect(writtenFiles).toHaveLength(0);
    expect(ghCalls[0]).toContain('--public');
  });

  test('missing git identity falls back to -c user.name/user.email', async () => {
    state.commitNeedsIdentity = true;

    const result = await initRepository({ path: TEST_DIR });

    expect(result.success).toBe(true);
    expect(gitCalls).toContainEqual([
      '-c',
      'user.name=rapitas',
      '-c',
      'user.email=rapitas@local',
      'commit',
      '-m',
      'chore: initial commit',
    ]);
  });
});

describe('initRepository — existing repository/remote', () => {
  test('repo with https origin returns URL without creating anything', async () => {
    state.hasDotGit = true;
    state.headExists = true;
    state.currentBranch = 'main';
    state.remoteUrl = 'https://github.com/someone/existing-repo.git';

    const result = await initRepository({ path: TEST_DIR });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.repositoryUrl).toBe('https://github.com/someone/existing-repo');
    expect(result.branch).toBe('main');
    expect(result.steps).toEqual({
      gitInit: false,
      initialCommit: false,
      repoCreated: false,
      pushed: false,
    });
    expect(ghCalls.some((c) => c[1] === 'create')).toBe(false);
    expect(gitCalls.some((c) => c[0] === 'init')).toBe(false);
  });

  test('ssh origin is normalized to the https URL form', async () => {
    state.hasDotGit = true;
    state.headExists = true;
    state.currentBranch = 'develop';
    state.remoteUrl = 'git@github.com:MyOwner/My-Repo.git';

    const result = await initRepository({ path: TEST_DIR });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.repositoryUrl).toBe('https://github.com/myowner/my-repo');
    expect(result.steps.repoCreated).toBe(false);
    expect(result.steps.pushed).toBe(false);
  });

  test('non-github origin fails with remote_mismatch', async () => {
    state.hasDotGit = true;
    state.headExists = true;
    state.remoteUrl = 'https://gitlab.com/someone/elsewhere.git';

    const result = await initRepository({ path: TEST_DIR });

    expect(result).toMatchObject({ success: false, code: 'remote_mismatch' });
  });
});

describe('initRepository — preconditions', () => {
  test('missing path fails with path_not_found', async () => {
    state.dirExists = false;

    const result = await initRepository({ path: TEST_DIR });

    expect(result).toMatchObject({ success: false, code: 'path_not_found' });
  });

  test('gh not installed fails with gh_unavailable', async () => {
    state.ghAvailable = false;

    const result = await initRepository({ path: TEST_DIR });

    expect(result).toMatchObject({ success: false, code: 'gh_unavailable' });
  });

  test('gh unauthenticated fails with gh_unauthenticated', async () => {
    state.ghAuthed = false;

    const result = await initRepository({ path: TEST_DIR });

    expect(result).toMatchObject({ success: false, code: 'gh_unauthenticated' });
    expect(gitCalls).toHaveLength(0);
    expect(ghCalls).toHaveLength(0);
  });

  test('gh repo create failure surfaces stderr with gh_failed', async () => {
    state.repoCreateError = 'GraphQL: Name already exists on this account (createRepository)';

    const result = await initRepository({ path: TEST_DIR });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.code).toBe('gh_failed');
    expect(result.error).toContain('Name already exists');
  });
});

describe('createBranch', () => {
  /** Puts state into "existing repo with commits on develop" shape. */
  function asRepo(): void {
    state.hasDotGit = true;
    state.headExists = true;
    state.currentBranch = 'develop';
  }

  test('create + push happy path, never checks out', async () => {
    asRepo();
    state.remoteUrl = 'https://github.com/someone/existing-repo.git';

    const result = await createBranch({ path: TEST_DIR, branchName: 'feature/new-ui' });

    expect(result).toEqual({
      success: true,
      branch: 'feature/new-ui',
      steps: { created: true, pushed: true },
    });
    expect(gitCalls).toContainEqual(['branch', 'feature/new-ui']);
    expect(gitCalls).toContainEqual(['push', '-u', 'origin', 'feature/new-ui:feature/new-ui']);
    // Hard requirement: the current working branch must never change.
    expect(gitCalls.some((c) => c[0] === 'checkout' || c[0] === 'switch')).toBe(false);
  });

  test('baseBranch resolves via origin/<base> fallback', async () => {
    asRepo();
    state.remoteUrl = 'https://github.com/someone/existing-repo.git';
    state.resolvableRefs = ['origin/main'];

    const result = await createBranch({
      path: TEST_DIR,
      branchName: 'hotfix/x',
      baseBranch: 'main',
    });

    expect(result.success).toBe(true);
    expect(gitCalls).toContainEqual(['branch', 'hotfix/x', 'origin/main']);
  });

  test('branch already exists locally: created=false but still pushed', async () => {
    asRepo();
    state.remoteUrl = 'https://github.com/someone/existing-repo.git';
    state.localBranches = ['feature/new-ui'];

    const result = await createBranch({ path: TEST_DIR, branchName: 'feature/new-ui' });

    expect(result).toEqual({
      success: true,
      branch: 'feature/new-ui',
      steps: { created: false, pushed: true },
    });
    expect(gitCalls.some((c) => c[0] === 'branch')).toBe(false);
  });

  test('branch already on remote: pushed=false, no push call', async () => {
    asRepo();
    state.remoteUrl = 'https://github.com/someone/existing-repo.git';
    state.localBranches = ['feature/new-ui'];
    state.remoteBranches = ['feature/new-ui'];

    const result = await createBranch({ path: TEST_DIR, branchName: 'feature/new-ui' });

    expect(result).toEqual({
      success: true,
      branch: 'feature/new-ui',
      steps: { created: false, pushed: false },
    });
    expect(gitCalls.some((c) => c[0] === 'push')).toBe(false);
  });

  test('invalid branch name fails with invalid_branch_name', async () => {
    asRepo();

    const result = await createBranch({ path: TEST_DIR, branchName: 'bad name' });

    expect(result).toMatchObject({ success: false, code: 'invalid_branch_name' });
    expect(gitCalls.some((c) => c[0] === 'branch')).toBe(false);
  });

  test('non-repo path fails with not_a_repo', async () => {
    state.hasDotGit = false;

    const result = await createBranch({ path: TEST_DIR, branchName: 'feature/x' });

    expect(result).toMatchObject({ success: false, code: 'not_a_repo' });
  });

  test('missing path fails with path_not_found', async () => {
    state.dirExists = false;

    const result = await createBranch({ path: TEST_DIR, branchName: 'feature/x' });

    expect(result).toMatchObject({ success: false, code: 'path_not_found' });
  });

  test('no origin remote: local-only creation succeeds with pushed=false', async () => {
    asRepo();
    state.remoteUrl = null;

    const result = await createBranch({ path: TEST_DIR, branchName: 'feature/local-only' });

    expect(result).toEqual({
      success: true,
      branch: 'feature/local-only',
      steps: { created: true, pushed: false },
    });
    expect(gitCalls.some((c) => c[0] === 'push' || c[0] === 'ls-remote')).toBe(false);
  });

  test('unresolvable baseBranch fails with git_failed', async () => {
    asRepo();

    const result = await createBranch({
      path: TEST_DIR,
      branchName: 'feature/x',
      baseBranch: 'no-such-base',
    });

    expect(result).toMatchObject({ success: false, code: 'git_failed' });
  });
});

describe('sanitizeRepoName', () => {
  test('replaces disallowed chars and collapses/trims dashes', () => {
    expect(sanitizeRepoName('My Cool App!')).toBe('My-Cool-App');
    expect(sanitizeRepoName('a.b_c-d')).toBe('a.b_c-d');
    expect(sanitizeRepoName('--weird  name--')).toBe('weird-name');
  });
});
