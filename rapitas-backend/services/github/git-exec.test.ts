/**
 * git-exec.test
 *
 * Tests for git CLI execution utilities:
 * - runGitCommand: delegates to execFile, returns trimmed stdout, throws on failure
 * - parseOwnerRepo: regex coverage for https/ssh/edge cases, output is lowercased
 * - ownerRepoFromGitRemote: success and failure paths via runGitCommand mock
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mutable state shared with the execFile mock closure.
let capturedArgs: string[] = [];
let shouldFail = false;
let gitStdout = '';
let gitStderr = 'mock git error';

const mockExecFile = mock(
  (
    _bin: string,
    args: string[],
    _opts: object,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    capturedArgs = [...args];
    if (shouldFail) {
      const err = Object.assign(new Error(gitStderr), { stderr: gitStderr });
      cb(err);
    } else {
      cb(null, { stdout: gitStdout, stderr: '' });
    }
  },
);

// NOTE: Mirror ALL exports to prevent "export not found" in the same bun process
// when other test files import child_process (bun mock.module is process-global).
mock.module('child_process', () => ({
  execFile: mockExecFile,
  exec: mock(() => {}),
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  }),
}));

const { runGitCommand, parseOwnerRepo, ownerRepoFromGitRemote, clearAllGitRemoteCache } =
  await import('./git-exec');

// ─── runGitCommand ────────────────────────────────────────────────────────────

describe('runGitCommand', () => {
  beforeEach(() => {
    capturedArgs = [];
    shouldFail = false;
    gitStdout = '';
    gitStderr = 'mock git error';
    mockExecFile.mockClear();
  });

  it('success: trimmed stdout を返す', async () => {
    gitStdout = '  https://github.com/owner/repo\n';
    const result = await runGitCommand(['remote', 'get-url', 'origin'], '/workspace');
    expect(result).toBe('https://github.com/owner/repo');
    expect(capturedArgs).toEqual(['remote', 'get-url', 'origin']);
  });

  it('cwd を execFile に渡す', async () => {
    gitStdout = 'main';
    await runGitCommand(['branch', '--show-current'], '/my/repo');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('failure: stderr を含む Error を throw する', async () => {
    shouldFail = true;
    gitStderr = 'fatal: not a git repository';
    await expect(runGitCommand(['status'], '/workspace')).rejects.toThrow(
      'fatal: not a git repository',
    );
  });

  it('skipLog: true でも失敗時は throw する', async () => {
    shouldFail = true;
    await expect(runGitCommand(['status'], undefined, { skipLog: true })).rejects.toThrow();
  });

  it('cwd なしで execFile を呼べる', async () => {
    gitStdout = 'main';
    const result = await runGitCommand(['branch', '--show-current']);
    expect(result).toBe('main');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});

// ─── parseOwnerRepo ───────────────────────────────────────────────────────────

describe('parseOwnerRepo', () => {
  it('https URL → 小文字化した owner/repo を返す', () => {
    expect(parseOwnerRepo('https://github.com/Owner/Repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('ssh URL (git@github.com:owner/repo.git) → owner/repo を返す', () => {
    expect(parseOwnerRepo('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('.git サフィックスなしの https URL', () => {
    expect(parseOwnerRepo('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('末尾スラッシュつきの URL', () => {
    expect(parseOwnerRepo('https://github.com/owner/repo/')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('大文字混じりの URL → 小文字化する', () => {
    expect(parseOwnerRepo('https://github.com/MyOrg/MyRepo.git')).toEqual({
      owner: 'myorg',
      repo: 'myrepo',
    });
  });

  it('? を含む URL → null', () => {
    expect(parseOwnerRepo('https://github.com/owner/repo?tab=readme')).toBeNull();
  });

  it('# を含む URL → null', () => {
    expect(parseOwnerRepo('https://github.com/owner/repo#readme')).toBeNull();
  });

  it('非 github URL → null', () => {
    expect(parseOwnerRepo('https://gitlab.com/owner/repo')).toBeNull();
  });

  it('null → null', () => {
    expect(parseOwnerRepo(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(parseOwnerRepo(undefined)).toBeNull();
  });

  it('空文字 → null', () => {
    expect(parseOwnerRepo('')).toBeNull();
  });
});

// ─── ownerRepoFromGitRemote ───────────────────────────────────────────────────

describe('ownerRepoFromGitRemote', () => {
  beforeEach(() => {
    capturedArgs = [];
    shouldFail = false;
    gitStdout = '';
    mockExecFile.mockClear();
    // NOTE: Clear remote URL cache between tests to prevent stale entries
    // from one test affecting the next when both use the same cwd.
    clearAllGitRemoteCache();
  });

  it('リモートあり → owner/repo を小文字で返す', async () => {
    gitStdout = 'https://github.com/MyOrg/MyRepo.git\n';
    const result = await ownerRepoFromGitRemote('/workspace');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo' });
    expect(capturedArgs).toEqual(['remote', 'get-url', 'origin']);
  });

  it('git コマンド失敗 → null を返す', async () => {
    shouldFail = true;
    const result = await ownerRepoFromGitRemote('/workspace');
    expect(result).toBeNull();
  });

  it('非 github URL → null を返す', async () => {
    gitStdout = 'https://gitlab.com/owner/repo.git\n';
    const result = await ownerRepoFromGitRemote('/workspace');
    expect(result).toBeNull();
  });

  it('ssh URL も解析できる', async () => {
    gitStdout = 'git@github.com:org/proj.git\n';
    const result = await ownerRepoFromGitRemote('/workspace');
    expect(result).toEqual({ owner: 'org', repo: 'proj' });
  });
});
