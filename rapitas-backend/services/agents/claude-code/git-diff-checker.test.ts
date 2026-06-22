/**
 * git-diff-checker.test
 *
 * Tests for checkGitDiff, covering all detection branches.
 * runGitCommand is mocked via git-exec so the test never shells out to git.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockRunGitCommand = mock(async (_args: string[], _cwd?: string) => '');

// NOTE: Mirror ALL exports from git-exec to prevent "export not found" errors
// in the same bun process. mock.module is process-global.
mock.module('../../github/git-exec', () => ({
  runGitCommand: mockRunGitCommand,
  runGitCommandWithRetry: mock(async () => ''),
  classifyGitError: mock(() => 'unrecoverable'),
  parseOwnerRepo: mock(() => null),
  ownerRepoFromGitRemote: mock(async () => null),
  clearGitRemoteCache: mock(() => {}),
  clearAllGitRemoteCache: mock(() => {}),
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

const WORK_DIR = '/workspace';
const LOG_PREFIX = '[test]';

describe('checkGitDiff', () => {
  beforeEach(() => {
    mockRunGitCommand.mockClear();
    // Default: all git commands return empty (no changes)
    mockRunGitCommand.mockImplementation(async () => '');
  });

  it('非gitリポジトリ (rev-parse が "true" 以外): throw する', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'false';
      return '';
    });
    await expect(checkGitDiff(WORK_DIR, LOG_PREFIX)).rejects.toThrow(
      'workDir is not a git repository',
    );
  });

  it('rev-parse が throw する場合はそのまま伝播する', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') throw new Error('fatal: not a git repository');
      return '';
    });
    await expect(checkGitDiff(WORK_DIR, LOG_PREFIX)).rejects.toThrow('fatal: not a git repository');
  });

  it('unstaged changes あり → true を返す', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      if (args[0] === 'diff' && args.includes('HEAD')) return ' 1 file changed, 2 insertions(+)';
      return '';
    });
    expect(await checkGitDiff(WORK_DIR, LOG_PREFIX)).toBe(true);
  });

  it('staged changes あり → true を返す', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      if (args[0] === 'diff' && args.includes('--cached')) return ' 1 file changed';
      return '';
    });
    expect(await checkGitDiff(WORK_DIR, LOG_PREFIX)).toBe(true);
  });

  it('status --porcelain に出力あり → true を返す', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      if (args[0] === 'status') return 'M  some-file.ts';
      return '';
    });
    expect(await checkGitDiff(WORK_DIR, LOG_PREFIX)).toBe(true);
  });

  it('recent commit あり → true を返す', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      if (args[0] === 'log') return 'abc1234 feat: add feature';
      return '';
    });
    expect(await checkGitDiff(WORK_DIR, LOG_PREFIX)).toBe(true);
  });

  it('全コマンドが空 → false を返す', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      return '';
    });
    expect(await checkGitDiff(WORK_DIR, LOG_PREFIX)).toBe(false);
  });

  it('timeoutMs: 5000 が各 runGitCommand 呼び出しに渡される', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      return '';
    });
    await checkGitDiff(WORK_DIR, LOG_PREFIX);
    // All calls should have been made with timeoutMs: 5000
    const allCalls = mockRunGitCommand.mock.calls;
    expect(allCalls.length).toBeGreaterThan(0);
    for (const call of allCalls) {
      const opts = call[2] as { timeoutMs?: number } | undefined;
      expect(opts?.timeoutMs).toBe(5000);
    }
  });

  it('unstaged あり → 後続コマンドを呼ばず早期 return', async () => {
    let callCount = 0;
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      callCount++;
      if (args[0] === 'rev-parse') return 'true';
      if (args[0] === 'diff' && args.includes('HEAD')) return 'some diff output';
      return '';
    });
    await checkGitDiff(WORK_DIR, LOG_PREFIX);
    // rev-parse + diff HEAD = 2 calls; should NOT call diff --cached, status, log
    expect(callCount).toBe(2);
  });
});
