/**
 * git-diff-checker.test
 *
 * Tests for checkGitDiff:
 * - non-git repository (rev-parse throws) → propagates error
 * - unstaged changes → returns true
 * - staged changes → returns true
 * - working tree status changes → returns true
 * - recent commit → returns true
 * - no changes at all → returns false
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mutable state shared with the runGitCommand mock closure.
type GitCallResult = { result: string } | { error: Error };
let gitCallQueue: GitCallResult[] = [];

const mockRunGitCommand = mock(
  (_args: string[], _cwd?: string, _opts?: unknown): Promise<string> => {
    const next = gitCallQueue.shift();
    if (!next) return Promise.resolve('');
    if ('error' in next) return Promise.reject(next.error);
    return Promise.resolve(next.result);
  },
);

// NOTE: Mirror ALL exports from git-exec to prevent "export not found" for
// other test files sharing the same bun process (mock.module is process-global).
mock.module('../../github/git-exec', () => ({
  runGitCommand: mockRunGitCommand,
  runGitCommandWithRetry: mock(() => Promise.resolve('')),
  parseOwnerRepo: mock(() => null),
  ownerRepoFromGitRemote: mock(() => Promise.resolve(null)),
  classifyGitError: mock(() => 'unrecoverable'),
  GIT_READ_RETRY_POLICY: { retryOn: ['transient'], maxRetries: 2, baseDelay: 500, maxDelay: 8000 },
  GIT_WRITE_RETRY_POLICY: { retryOn: [], maxRetries: 0, baseDelay: 1000, maxDelay: 8000 },
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  }),
}));

const { checkGitDiff } = await import('./git-diff-checker');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Queue git call results in order: rev-parse, unstaged, staged, status, log */
function queueResults(revParse: string, unstaged: string, staged: string, status: string, log: string): void {
  gitCallQueue = [
    { result: revParse },
    { result: unstaged },
    { result: staged },
    { result: status },
    { result: log },
  ];
}

// ─── checkGitDiff ─────────────────────────────────────────────────────────────

describe('checkGitDiff', () => {
  beforeEach(() => {
    gitCallQueue = [];
    mockRunGitCommand.mockClear();
  });

  it('rev-parse が throw → エラーを伝播する', async () => {
    gitCallQueue = [{ error: new Error('fatal: not a git repository') }];
    await expect(checkGitDiff('/not-a-repo', '[agent]')).rejects.toThrow(
      'fatal: not a git repository',
    );
    expect(mockRunGitCommand).toHaveBeenCalledTimes(1);
  });

  it('rev-parse が "true" 以外 → workDir not a git repository エラー', async () => {
    gitCallQueue = [{ result: 'false' }];
    await expect(checkGitDiff('/not-a-repo', '[agent]')).rejects.toThrow(
      'workDir is not a git repository',
    );
  });

  it('unstaged 変更あり → true を返す', async () => {
    gitCallQueue = [
      { result: 'true' },
      { result: '1 file changed' }, // unstaged
    ];
    const result = await checkGitDiff('/repo', '[agent]');
    expect(result).toBe(true);
    expect(mockRunGitCommand).toHaveBeenCalledTimes(2);
  });

  it('staged 変更あり → true を返す', async () => {
    gitCallQueue = [
      { result: 'true' },
      { result: '' },            // unstaged: none
      { result: '1 file changed' }, // staged
    ];
    const result = await checkGitDiff('/repo', '[agent]');
    expect(result).toBe(true);
    expect(mockRunGitCommand).toHaveBeenCalledTimes(3);
  });

  it('status 変更あり → true を返す', async () => {
    gitCallQueue = [
      { result: 'true' },
      { result: '' }, // unstaged: none
      { result: '' }, // staged: none
      { result: 'M  src/foo.ts' }, // status
    ];
    const result = await checkGitDiff('/repo', '[agent]');
    expect(result).toBe(true);
    expect(mockRunGitCommand).toHaveBeenCalledTimes(4);
  });

  it('recent commit あり → true を返す', async () => {
    queueResults('true', '', '', '', 'abc1234 feat: something');
    const result = await checkGitDiff('/repo', '[agent]');
    expect(result).toBe(true);
    expect(mockRunGitCommand).toHaveBeenCalledTimes(5);
  });

  it('全変更なし → false を返す', async () => {
    queueResults('true', '', '', '', '');
    const result = await checkGitDiff('/repo', '[agent]');
    expect(result).toBe(false);
    expect(mockRunGitCommand).toHaveBeenCalledTimes(5);
  });

  it('runGitCommand に timeoutMs: 5000 を渡している', async () => {
    queueResults('true', '', '', '', '');
    await checkGitDiff('/repo', '[agent]');
    // すべての呼び出しで第3引数に timeoutMs: 5000 が含まれることを確認
    const calls = mockRunGitCommand.mock.calls as Array<[string[], string?, { timeoutMs?: number }?]>;
    for (const call of calls) {
      expect(call[2]).toEqual({ timeoutMs: 5000 });
    }
  });

  it('最初の変更で即座に return し残りの git コマンドを呼ばない', async () => {
    gitCallQueue = [
      { result: 'true' },
      { result: 'modified src/foo.ts' }, // unstaged: has changes → early return
    ];
    const result = await checkGitDiff('/repo', '[agent]');
    expect(result).toBe(true);
    // rev-parse + unstaged の 2 回のみ呼ばれる
    expect(mockRunGitCommand).toHaveBeenCalledTimes(2);
  });
});
