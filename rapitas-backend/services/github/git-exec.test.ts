/**
 * git-exec.test
 *
 * Tests for git CLI execution utilities:
 * - runGitCommand: delegates to execFile, returns trimmed stdout, throws on failure, supports timeoutMs
 * - parseOwnerRepo: regex coverage for https/ssh/edge cases, output is lowercased
 * - ownerRepoFromGitRemote: success and failure paths via runGitCommand mock
 * - classifyGitError: auth/not_found/transient/unrecoverable classification
 * - runGitCommandWithRetry: transient retry, auth immediate throw, retry exhaustion
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mutable state shared with the execFile mock closure.
let capturedArgs: string[] = [];
let capturedOpts: Record<string, unknown> = {};
let shouldFail = false;
let gitStdout = '';
let gitStderr = 'mock git error';

const mockExecFile = mock(
  (
    _bin: string,
    args: string[],
    opts: Record<string, unknown>,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    capturedArgs = [...args];
    capturedOpts = { ...opts };
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

// NOTE: Mirror ALL exports from agent-retry to prevent "export not found" for
// other test files sharing the same bun process (mock.module is process-global).
const mockSleep = mock((_ms: number) => Promise.resolve());
mock.module('../agents/abstraction/agent-retry', () => ({
  sleep: mockSleep,
  evaluateRetry: mock(() => Promise.resolve({ shouldRetry: false, delay: 0 })),
  executeWithRetry: mock(() => Promise.resolve()),
  continueWithRetry: mock(() => Promise.resolve()),
}));

const {
  runGitCommand,
  parseOwnerRepo,
  ownerRepoFromGitRemote,
  clearAllGitRemoteCache,
  classifyGitError,
  GIT_READ_RETRY_POLICY,
  GIT_WRITE_RETRY_POLICY,
  runGitCommandWithRetry,
} = await import('./git-exec');

// ─── runGitCommand ────────────────────────────────────────────────────────────

describe('runGitCommand', () => {
  beforeEach(() => {
    capturedArgs = [];
    capturedOpts = {};
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

  it('timeoutMs を execFile の timeout オプションに渡す', async () => {
    gitStdout = 'main';
    await runGitCommand(['branch', '--show-current'], '/repo', { timeoutMs: 5000 });
    expect(capturedOpts.timeout).toBe(5000);
  });

  it('timeoutMs 未指定時は timeout が undefined になる', async () => {
    gitStdout = 'main';
    await runGitCommand(['branch', '--show-current'], '/repo');
    expect(capturedOpts.timeout).toBeUndefined();
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

// ─── classifyGitError ─────────────────────────────────────────────────────────

describe('classifyGitError', () => {
  it('auth: Authentication failed', () => {
    expect(classifyGitError('Authentication failed for ...')).toBe('auth');
  });

  it('auth: could not read Username', () => {
    expect(classifyGitError('could not read Username for remote')).toBe('auth');
  });

  it('auth: Permission denied (publickey)', () => {
    expect(classifyGitError('Permission denied (publickey).')).toBe('auth');
  });

  it('auth: terminal prompts disabled', () => {
    expect(classifyGitError('terminal prompts disabled')).toBe('auth');
  });

  it('auth: invalid credentials', () => {
    expect(classifyGitError('invalid credentials')).toBe('auth');
  });

  it('auth: 403 が transient より先にマッチする', () => {
    // "unable to access 'https://...': The requested URL returned error: 403"
    expect(classifyGitError("unable to access 'https://example.com': error: 403")).toBe('auth');
  });

  it('not_found: not a git repository', () => {
    expect(classifyGitError('fatal: not a git repository')).toBe('not_found');
  });

  it('not_found: pathspec did not match', () => {
    expect(classifyGitError("error: pathspec 'HEAD' did not match any file(s)")).toBe('not_found');
  });

  it('not_found: unknown revision', () => {
    expect(classifyGitError('fatal: unknown revision or path not in the working tree')).toBe(
      'not_found',
    );
  });

  it("not_found: couldn't find remote ref", () => {
    expect(classifyGitError("error: couldn't find remote ref main")).toBe('not_found');
  });

  it('not_found: repository not found', () => {
    expect(classifyGitError('ERROR: Repository not found.')).toBe('not_found');
  });

  it('not_found: 404', () => {
    expect(classifyGitError('fatal: repository returned HTTP 404')).toBe('not_found');
  });

  it('transient: Could not resolve host', () => {
    expect(classifyGitError('Could not resolve host: github.com')).toBe('transient');
  });

  it('transient: Connection timed out', () => {
    expect(classifyGitError('connect to host github.com port 443: Connection timed out')).toBe(
      'transient',
    );
  });

  it('transient: ETIMEDOUT', () => {
    expect(classifyGitError('fetch failed: ETIMEDOUT')).toBe('transient');
  });

  it('transient: ECONNRESET', () => {
    expect(classifyGitError('ECONNRESET')).toBe('transient');
  });

  it('transient: early EOF', () => {
    expect(classifyGitError('fatal: early EOF')).toBe('transient');
  });

  it('transient: RPC failed', () => {
    expect(classifyGitError('error: RPC failed; HTTP 500 curl 22')).toBe('transient');
  });

  it('transient: the remote end hung up', () => {
    expect(classifyGitError('fatal: the remote end hung up unexpectedly')).toBe('transient');
  });

  it('transient: unable to access (non-403)', () => {
    expect(classifyGitError("fatal: unable to access 'https://github.com/': error: 502")).toBe(
      'transient',
    );
  });

  it('unrecoverable: 未認識のエラー', () => {
    expect(classifyGitError('some completely unknown git error')).toBe('unrecoverable');
  });

  it('unrecoverable: 空文字', () => {
    expect(classifyGitError('')).toBe('unrecoverable');
  });
});

// ─── GIT_READ_RETRY_POLICY / GIT_WRITE_RETRY_POLICY ─────────────────────────

describe('retry policy constants', () => {
  it('GIT_READ_RETRY_POLICY: transient のみリトライ、maxRetries=2', () => {
    expect(GIT_READ_RETRY_POLICY.retryOn).toEqual(['transient']);
    expect(GIT_READ_RETRY_POLICY.maxRetries).toBe(2);
  });

  it('GIT_WRITE_RETRY_POLICY: retryOn が空 (自動リトライ無効)', () => {
    expect(GIT_WRITE_RETRY_POLICY.retryOn).toEqual([]);
    expect(GIT_WRITE_RETRY_POLICY.maxRetries).toBe(0);
  });
});

// ─── runGitCommandWithRetry ───────────────────────────────────────────────────

describe('runGitCommandWithRetry', () => {
  beforeEach(() => {
    capturedArgs = [];
    capturedOpts = {};
    shouldFail = false;
    gitStdout = '';
    gitStderr = 'mock git error';
    mockExecFile.mockClear();
    mockSleep.mockClear();
  });

  it('初回成功: sleep を呼ばずに結果を返す', async () => {
    gitStdout = 'true';
    const result = await runGitCommandWithRetry(['rev-parse', '--is-inside-work-tree'], '/repo');
    expect(result).toBe('true');
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('transient エラー後に成功: 1回リトライして結果を返す', async () => {
    gitStderr = 'Could not resolve host: github.com';
    let callCount = 0;
    mockExecFile.mockImplementation(
      (
        _bin: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
      ) => {
        callCount++;
        if (callCount === 1) {
          const err = Object.assign(new Error(gitStderr), { stderr: gitStderr });
          cb(err);
        } else {
          cb(null, { stdout: 'ok', stderr: '' });
        }
      },
    );

    const result = await runGitCommandWithRetry(['fetch'], '/repo');
    expect(result).toBe('ok');
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledTimes(2);

    // Restore default mock
    mockExecFile.mockImplementation(
      (
        _bin: string,
        args: string[],
        opts: Record<string, unknown>,
        cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
      ) => {
        capturedArgs = [...args];
        capturedOpts = { ...opts };
        if (shouldFail) {
          const err = Object.assign(new Error(gitStderr), { stderr: gitStderr });
          cb(err);
        } else {
          cb(null, { stdout: gitStdout, stderr: '' });
        }
      },
    );
  });

  it('auth エラー: リトライせず即 throw', async () => {
    shouldFail = true;
    gitStderr = 'Authentication failed for https://github.com/';
    await expect(runGitCommandWithRetry(['fetch'], '/repo')).rejects.toThrow(
      'Authentication failed',
    );
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('unrecoverable エラー: リトライせず即 throw', async () => {
    shouldFail = true;
    gitStderr = 'some completely unknown error';
    await expect(runGitCommandWithRetry(['fetch'], '/repo')).rejects.toThrow(
      'some completely unknown error',
    );
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('transient が maxRetries 枯渇: 最後のエラーを throw', async () => {
    shouldFail = true;
    gitStderr = 'Could not resolve host: github.com';
    await expect(runGitCommandWithRetry(['fetch'], '/repo')).rejects.toThrow(
      'Could not resolve host',
    );
    // READ_RETRY_POLICY: maxRetries=2 → 1回目失敗+2回リトライ = 3回 execFile
    expect(mockExecFile).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledTimes(2);
  });

  it('カスタムポリシー: GIT_WRITE_RETRY_POLICY で transient もリトライしない', async () => {
    shouldFail = true;
    gitStderr = 'Could not resolve host: github.com';
    await expect(
      runGitCommandWithRetry(['push'], '/repo', { policy: GIT_WRITE_RETRY_POLICY }),
    ).rejects.toThrow('Could not resolve host');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('既定ポリシーは GIT_READ_RETRY_POLICY (transient をリトライ)', async () => {
    shouldFail = true;
    gitStderr = 'ETIMEDOUT';
    await expect(runGitCommandWithRetry(['status'], '/repo')).rejects.toThrow();
    // transient with maxRetries=2 → 3 total calls
    expect(mockExecFile).toHaveBeenCalledTimes(3);
  });
});
