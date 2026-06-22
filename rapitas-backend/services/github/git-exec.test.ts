/**
 * git-exec.test
 *
 * Tests for git CLI execution utilities:
 * - runGitCommand: delegates to execFile, returns trimmed stdout, throws on failure
 * - parseOwnerRepo: regex coverage for https/ssh/edge cases, output is lowercased
 * - ownerRepoFromGitRemote: success and failure paths via runGitCommand mock
 * - classifyGitError: error message categorization
 * - runGitCommandWithRetry: transient retry, auth immediate throw, exhaustion
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// NOTE: Mirror ALL exports from agent-retry to avoid "export not found" in the same
// bun process. mock.module is process-global; other test files may also import agent-retry.
const mockSleep = mock((_ms: number) => Promise.resolve());

mock.module('../agents/abstraction/agent-retry', () => ({
  sleep: mockSleep,
  evaluateRetry: mock(async () => ({ shouldRetry: false, delay: 0 })),
  executeWithRetry: mock(async () => ({})),
  continueWithRetry: mock(async () => ({})),
}));

// Mutable state shared with the execFile mock closure.
let capturedArgs: string[] = [];
let capturedExecOpts: Record<string, unknown> = {};
let shouldFail = false;
// failCount > 0: fail exactly that many times, then succeed
let failCount = 0;
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
    capturedExecOpts = { ...opts };
    const thisFail = shouldFail || failCount > 0;
    if (failCount > 0) failCount--;
    if (thisFail) {
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

const {
  runGitCommand,
  parseOwnerRepo,
  ownerRepoFromGitRemote,
  clearAllGitRemoteCache,
  classifyGitError,
  runGitCommandWithRetry,
  GIT_READ_RETRY_POLICY,
  GIT_WRITE_RETRY_POLICY,
} = await import('./git-exec');

// ─── runGitCommand ────────────────────────────────────────────────────────────

describe('runGitCommand', () => {
  beforeEach(() => {
    capturedArgs = [];
    capturedExecOpts = {};
    shouldFail = false;
    failCount = 0;
    gitStdout = '';
    gitStderr = 'mock git error';
    mockExecFile.mockClear();
    mockSleep.mockClear();
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
    gitStdout = 'ok';
    await runGitCommand(['status'], '/workspace', { timeoutMs: 5000 });
    expect(capturedExecOpts['timeout']).toBe(5000);
  });

  it('timeoutMs 未指定時は timeout オプションが undefined', async () => {
    gitStdout = 'ok';
    await runGitCommand(['status'], '/workspace');
    expect(capturedExecOpts['timeout']).toBeUndefined();
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
    failCount = 0;
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

// ─── classifyGitError ────────────────────────────────────────────────────────

describe('classifyGitError', () => {
  it('auth: Authentication failed', () => {
    expect(classifyGitError('Authentication failed for https://github.com/owner/repo')).toBe(
      'auth',
    );
  });

  it('auth: could not read Username', () => {
    expect(classifyGitError('could not read Username for https://github.com')).toBe('auth');
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

  it('auth: 403', () => {
    expect(classifyGitError('unable to access: 403 Forbidden')).toBe('auth');
  });

  it('not_found: not a git repository', () => {
    expect(classifyGitError('fatal: not a git repository')).toBe('not_found');
  });

  it('not_found: pathspec did not match', () => {
    expect(classifyGitError("pathspec 'foo' did not match any file(s) known to git")).toBe(
      'not_found',
    );
  });

  it('not_found: unknown revision', () => {
    expect(classifyGitError('fatal: unknown revision or path not in the working tree')).toBe(
      'not_found',
    );
  });

  it("not_found: couldn't find remote ref", () => {
    expect(classifyGitError("fatal: couldn't find remote ref main")).toBe('not_found');
  });

  it('not_found: repository not found', () => {
    expect(classifyGitError('ERROR: Repository not found.')).toBe('not_found');
  });

  it('not_found: 404', () => {
    expect(classifyGitError('The requested URL returned error: 404')).toBe('not_found');
  });

  it('transient: Could not resolve host', () => {
    expect(classifyGitError('Could not resolve host: github.com')).toBe('transient');
  });

  it('transient: Connection timed out', () => {
    expect(classifyGitError('Connection timed out')).toBe('transient');
  });

  it('transient: ETIMEDOUT', () => {
    expect(classifyGitError('connect ETIMEDOUT 140.82.121.4:443')).toBe('transient');
  });

  it('transient: ECONNRESET', () => {
    expect(classifyGitError('ECONNRESET socket hang up')).toBe('transient');
  });

  it('transient: early EOF', () => {
    expect(classifyGitError('error: RPC failed; curl 56 OpenSSL SSL_read: early EOF')).toBe(
      'transient',
    );
  });

  it('transient: the remote end hung up', () => {
    expect(classifyGitError('the remote end hung up unexpectedly')).toBe('transient');
  });

  it('transient: 502', () => {
    expect(classifyGitError('The requested URL returned error: 502')).toBe('transient');
  });

  it('transient: 503', () => {
    expect(classifyGitError('fatal: repository https://github.com/ not found (503)')).toBe(
      'transient',
    );
  });

  it('unrecoverable: unknown message', () => {
    expect(classifyGitError('some unexpected git error')).toBe('unrecoverable');
  });

  it('unrecoverable: empty string', () => {
    expect(classifyGitError('')).toBe('unrecoverable');
  });

  it('auth wins over transient: 403 in "unable to access" message', () => {
    // NOTE: "unable to access" would match transient, but "403" appears first in auth rule.
    expect(classifyGitError('fatal: unable to access: The requested URL returned error: 403')).toBe(
      'auth',
    );
  });
});

// ─── GIT_READ_RETRY_POLICY / GIT_WRITE_RETRY_POLICY ─────────────────────────

describe('retry policy constants', () => {
  it('GIT_READ_RETRY_POLICY retries transient with maxRetries=2', () => {
    expect(GIT_READ_RETRY_POLICY.retryOn).toEqual(['transient']);
    expect(GIT_READ_RETRY_POLICY.maxRetries).toBe(2);
    expect(GIT_READ_RETRY_POLICY.baseDelay).toBe(500);
    expect(GIT_READ_RETRY_POLICY.maxDelay).toBe(8000);
  });

  it('GIT_WRITE_RETRY_POLICY has no automatic retries', () => {
    expect(GIT_WRITE_RETRY_POLICY.retryOn).toEqual([]);
    expect(GIT_WRITE_RETRY_POLICY.maxRetries).toBe(0);
  });
});

// ─── runGitCommandWithRetry ───────────────────────────────────────────────────

describe('runGitCommandWithRetry', () => {
  beforeEach(() => {
    capturedArgs = [];
    capturedExecOpts = {};
    shouldFail = false;
    failCount = 0;
    gitStdout = '';
    gitStderr = 'mock git error';
    mockExecFile.mockClear();
    mockSleep.mockClear();
  });

  it('初回成功時は sleep を呼ばずに結果を返す', async () => {
    gitStdout = 'abc123';
    const result = await runGitCommandWithRetry(['log', '--oneline', '-1'], '/workspace');
    expect(result).toBe('abc123');
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('transient エラー後に成功: 1 回リトライして結果を返す', async () => {
    gitStderr = 'Could not resolve host: github.com';
    failCount = 1;
    gitStdout = 'success output';
    const result = await runGitCommandWithRetry(['fetch'], '/workspace', {
      policy: { retryOn: ['transient'], maxRetries: 2, baseDelay: 100, maxDelay: 1000 },
    });
    expect(result).toBe('success output');
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledTimes(1);
  });

  it('auth エラーは即 throw でリトライしない', async () => {
    shouldFail = true;
    gitStderr = 'Authentication failed for https://github.com/owner/repo';
    await expect(runGitCommandWithRetry(['fetch'], '/workspace')).rejects.toThrow(
      'Authentication failed',
    );
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('unrecoverable エラーは即 throw でリトライしない', async () => {
    shouldFail = true;
    gitStderr = 'some unexpected git error';
    await expect(runGitCommandWithRetry(['status'], '/workspace')).rejects.toThrow(
      'some unexpected git error',
    );
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('maxRetries 枯渇時は最後のエラーを throw する', async () => {
    shouldFail = true;
    gitStderr = 'ETIMEDOUT connect failed';
    await expect(
      runGitCommandWithRetry(['fetch'], '/workspace', {
        policy: { retryOn: ['transient'], maxRetries: 2, baseDelay: 100, maxDelay: 1000 },
      }),
    ).rejects.toThrow('ETIMEDOUT');
    // 初回 + 2 リトライ = 3 回
    expect(mockExecFile).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledTimes(2);
  });

  it('デフォルトポリシーは GIT_READ_RETRY_POLICY (transient を maxRetries=2 でリトライ)', async () => {
    shouldFail = true;
    gitStderr = 'EAI_AGAIN getaddrinfo failed';
    await expect(runGitCommandWithRetry(['status'], '/workspace')).rejects.toThrow();
    // GIT_READ_RETRY_POLICY.maxRetries=2 なので 3 回呼ばれる
    expect(mockExecFile).toHaveBeenCalledTimes(3);
  });

  it('カスタムポリシーで retryOn が空の場合は即 throw', async () => {
    shouldFail = true;
    gitStderr = 'ETIMEDOUT connect failed';
    await expect(
      runGitCommandWithRetry(['push'], '/workspace', {
        policy: { retryOn: [], maxRetries: 0, baseDelay: 1000, maxDelay: 8000 },
      }),
    ).rejects.toThrow('ETIMEDOUT');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });
});
