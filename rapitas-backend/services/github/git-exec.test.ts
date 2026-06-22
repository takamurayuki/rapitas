/**
 * git-exec.test
 *
 * Tests for git CLI execution utilities:
 * - runGitCommand: delegates to execFile, returns trimmed stdout, throws on failure
 * - parseOwnerRepo: regex coverage for https/ssh/edge cases, output is lowercased
 * - ownerRepoFromGitRemote: success and failure paths via runGitCommand mock
 * - Counter behaviour: hits/misses/expiries/hitRate/expiryRate are computed correctly
 * - resetGitRemoteCacheStats: zeroes counters without clearing the Map
 * - clearAllGitRemoteCache: clears Map AND resets counters
 * - classifyGitError: error message categorization
 * - runGitCommandWithRetry: transient retry, auth immediate throw, exhaustion
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// NOTE: Mirror ALL exports from agent-retry to avoid "export not found" in the same
// bun process. mock.module is process-global; other test files may also import agent-retry.
const mockSleep = mock((_ms: number) => Promise.resolve());

mock.module('../agents/abstraction/agent-retry', () => ({
  sleep: mockSleep,
  evaluateRetry: mock(async () => ({ shouldRetry: false, delay: 0 })),
  executeWithRetry: mock(async () => ({})),
  continueWithRetry: mock(async () => ({})),
}));

// Mock telemetry to avoid real prisma calls in unit tests.
const mockRecordGitRetryMetric = mock((_input: unknown) => {});
mock.module('./git-retry-telemetry', () => ({
  recordGitRetryMetric: mockRecordGitRetryMetric,
}));

// Mock registry — expose real variant resolution but allow env-var control in tests.
mock.module('./git-retry-policy-registry', () => {
  const registry = {
    GIT_RETRY_VARIANTS: {
      default: { retryOn: ['transient'], maxRetries: 2, baseDelay: 500, maxDelay: 8000 },
      aggressive: { retryOn: ['transient'], maxRetries: 5, baseDelay: 200, maxDelay: 8000 },
      conservative: { retryOn: ['transient'], maxRetries: 1, baseDelay: 500, maxDelay: 16000 },
    },
    getActiveVariantName: () => {
      const v = process.env['RAPITAS_GIT_RETRY_VARIANT'];
      if (!v) return 'default';
      if (v in registry.GIT_RETRY_VARIANTS) return v;
      return 'default';
    },
    resolveActiveGitRetryPolicy: () => registry.GIT_RETRY_VARIANTS[registry.getActiveVariantName()],
  };
  return registry;
});

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
  getGitRemoteCacheStats,
  resetGitRemoteCacheStats,
  classifyGitError,
  runGitCommandWithRetry,
  GIT_READ_RETRY_POLICY,
  GIT_WRITE_RETRY_POLICY,
} = await import('./git-exec');

const GIT_RETRY_VARIANT_ENV = 'RAPITAS_GIT_RETRY_VARIANT';

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

// ─── Counter: miss → hit ──────────────────────────────────────────────────────

describe('getGitRemoteCacheStats — counter behaviour', () => {
  beforeEach(() => {
    shouldFail = false;
    gitStdout = '';
    mockExecFile.mockClear();
    clearAllGitRemoteCache();
  });

  it('初期状態はカウンタが全てゼロ', () => {
    const stats = getGitRemoteCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.expiries).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.expiryRate).toBe(0);
    expect(stats.size).toBe(0);
  });

  it('1回目はmiss、2回目はhitとして計上される', async () => {
    gitStdout = 'https://github.com/owner/repo.git\n';
    await ownerRepoFromGitRemote('/workspace/cnt');
    await ownerRepoFromGitRemote('/workspace/cnt');

    const stats = getGitRemoteCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.expiries).toBe(0);
    expect(stats.total).toBe(2);
    expect(stats.hitRate).toBe(0.5);
    expect(stats.expiryRate).toBe(0);
    expect(stats.size).toBe(1);
  });

  it('total===0 のとき hitRate / expiryRate は 0 (ゼロ除算回避)', () => {
    const stats = getGitRemoteCacheStats();
    expect(stats.total).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.expiryRate).toBe(0);
  });
});

// ─── resetGitRemoteCacheStats ─────────────────────────────────────────────────

describe('resetGitRemoteCacheStats', () => {
  beforeEach(() => {
    shouldFail = false;
    gitStdout = 'https://github.com/owner/repo.git\n';
    mockExecFile.mockClear();
    clearAllGitRemoteCache();
  });

  it('カウンタを0にリセットするがキャッシュMapは残す', async () => {
    await ownerRepoFromGitRemote('/workspace/reset');
    await ownerRepoFromGitRemote('/workspace/reset');
    expect(getGitRemoteCacheStats().total).toBe(2);
    expect(getGitRemoteCacheStats().size).toBe(1);

    resetGitRemoteCacheStats();

    const stats = getGitRemoteCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.expiries).toBe(0);
    expect(stats.total).toBe(0);
    // NOTE: Cache Map is preserved — next call should hit (not miss).
    expect(stats.size).toBe(1);

    await ownerRepoFromGitRemote('/workspace/reset');
    expect(getGitRemoteCacheStats().hits).toBe(1);
    expect(mockExecFile).toHaveBeenCalledTimes(1); // only the first miss called execFile
  });
});

// ─── clearAllGitRemoteCache resets counters ───────────────────────────────────

describe('clearAllGitRemoteCache — counter reset', () => {
  beforeEach(() => {
    shouldFail = false;
    gitStdout = 'https://github.com/owner/repo.git\n';
    mockExecFile.mockClear();
    clearAllGitRemoteCache();
  });

  it('clearAllGitRemoteCache はカウンタも0にする', async () => {
    await ownerRepoFromGitRemote('/workspace/clr');
    await ownerRepoFromGitRemote('/workspace/clr');

    clearAllGitRemoteCache();

    const stats = getGitRemoteCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.expiries).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.size).toBe(0);
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
    mockRecordGitRetryMetric.mockClear();
    delete process.env[GIT_RETRY_VARIANT_ENV];
  });

  afterEach(() => {
    delete process.env[GIT_RETRY_VARIANT_ENV];
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

  // ─── バリアント切り替えテスト ─────────────────────────────────────────────────

  it('env=aggressive → maxRetries=5 のポリシーが適用される', async () => {
    process.env[GIT_RETRY_VARIANT_ENV] = 'aggressive';
    shouldFail = true;
    gitStderr = 'Could not resolve host: github.com';
    await expect(runGitCommandWithRetry(['fetch'], '/workspace')).rejects.toThrow();
    // aggressive: maxRetries=5 → 初回 + 5 リトライ = 6 回
    expect(mockExecFile).toHaveBeenCalledTimes(6);
    expect(mockSleep).toHaveBeenCalledTimes(5);
  });

  it('env=conservative → maxRetries=1 のポリシーが適用される', async () => {
    process.env[GIT_RETRY_VARIANT_ENV] = 'conservative';
    shouldFail = true;
    gitStderr = 'Connection timed out';
    await expect(runGitCommandWithRetry(['fetch'], '/workspace')).rejects.toThrow();
    // conservative: maxRetries=1 → 初回 + 1 リトライ = 2 回
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledTimes(1);
  });

  it('env 未設定 → default ポリシー (maxRetries=2) が適用される', async () => {
    shouldFail = true;
    gitStderr = 'ETIMEDOUT connect failed';
    await expect(runGitCommandWithRetry(['fetch'], '/workspace')).rejects.toThrow();
    // default: maxRetries=2 → 3 回
    expect(mockExecFile).toHaveBeenCalledTimes(3);
  });

  // ─── 計測注入テスト ───────────────────────────────────────────────────────────

  it('初回成功時は計測を呼ばない', async () => {
    gitStdout = 'ok';
    await runGitCommandWithRetry(['fetch'], '/workspace');
    expect(mockRecordGitRetryMetric).not.toHaveBeenCalled();
  });

  it('リトライ→成功時は計測を1回呼ぶ (succeeded=true)', async () => {
    gitStderr = 'Could not resolve host: github.com';
    failCount = 1;
    gitStdout = 'success';
    await runGitCommandWithRetry(['fetch'], '/workspace', {
      policy: { retryOn: ['transient'], maxRetries: 2, baseDelay: 100, maxDelay: 1000 },
    });
    expect(mockRecordGitRetryMetric).toHaveBeenCalledTimes(1);
    const call = mockRecordGitRetryMetric.mock.calls[0][0] as Record<string, unknown>;
    expect(call.succeeded).toBe(true);
    expect(call.attempts).toBe(2);
    expect(call.command).toBe('fetch');
    expect(call.variant).toBe('explicit');
  });

  it('maxRetries 枯渇時は計測を1回呼ぶ (succeeded=false)', async () => {
    shouldFail = true;
    gitStderr = 'ETIMEDOUT connect failed';
    await expect(
      runGitCommandWithRetry(['fetch'], '/workspace', {
        policy: { retryOn: ['transient'], maxRetries: 2, baseDelay: 100, maxDelay: 1000 },
      }),
    ).rejects.toThrow('ETIMEDOUT');
    expect(mockRecordGitRetryMetric).toHaveBeenCalledTimes(1);
    const call = mockRecordGitRetryMetric.mock.calls[0][0] as Record<string, unknown>;
    expect(call.succeeded).toBe(false);
    expect(call.attempts).toBe(3); // 初回 + 2 リトライ
    expect(call.variant).toBe('explicit');
    expect(call.finalErrorCategory).toBe('transient');
  });

  it('初回 auth 失敗時は計測なし (リトライ未発生)', async () => {
    shouldFail = true;
    gitStderr = 'Authentication failed';
    await expect(runGitCommandWithRetry(['fetch'], '/workspace')).rejects.toThrow();
    expect(mockRecordGitRetryMetric).not.toHaveBeenCalled();
  });

  it('env バリアント使用時は variant 列が variant 名になる', async () => {
    process.env[GIT_RETRY_VARIANT_ENV] = 'aggressive';
    gitStderr = 'Could not resolve host: github.com';
    failCount = 1;
    gitStdout = 'ok';
    await runGitCommandWithRetry(['status'], '/workspace');
    expect(mockRecordGitRetryMetric).toHaveBeenCalledTimes(1);
    const call = mockRecordGitRetryMetric.mock.calls[0][0] as Record<string, unknown>;
    expect(call.variant).toBe('aggressive');
  });

  it('opts.policy 明示時は variant 列が "explicit"', async () => {
    gitStderr = 'Connection timed out';
    failCount = 1;
    gitStdout = 'ok';
    await runGitCommandWithRetry(['push'], '/workspace', {
      policy: { retryOn: ['transient'], maxRetries: 2, baseDelay: 100, maxDelay: 1000 },
    });
    expect(mockRecordGitRetryMetric).toHaveBeenCalledTimes(1);
    const call = mockRecordGitRetryMetric.mock.calls[0][0] as Record<string, unknown>;
    expect(call.variant).toBe('explicit');
  });
});
