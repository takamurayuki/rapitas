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

  it('作業ツリーは clean だがブランチ固有コミットあり → true を返す', async () => {
    // 再実行では実装が既に前回のコミットとして存在するため 1-4 は全て空になる。
    // それを「実装なし」と報告していた（task 633: 失敗扱いの直後に PR #437 が
    // 同じブランチから作られマージされた）。
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      if (args[0] === 'rev-list') return '3';
      return '';
    });
    expect(await checkGitDiff(WORK_DIR, LOG_PREFIX)).toBe(true);
  });

  it('ブランチ固有コミットが 0 件 → false のまま（計画だけの実行は失敗のまま）', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      if (args[0] === 'rev-list') return '0';
      return '';
    });
    expect(await checkGitDiff(WORK_DIR, LOG_PREFIX)).toBe(false);
  });

  it('rev-list が失敗しても throw せず false を返す', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      if (args[0] === 'rev-list') throw new Error('unknown revision origin/develop');
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

  it('回帰: 存在しない base ref があっても branch commit 判定が死なない', async () => {
    // 実測 2026-08-24 task 624: このリポジトリに master が無いため
    // `git rev-list --count HEAD --not ... origin/master master` が
    // "fatal: ambiguous argument 'origin/master'" で落ち、catch が握り潰して
    // 「変更なし」になっていた。実際にはブランチに9ファイル+809行の
    // 実装コミットがあり、main.rs は 840行→37行に分割済みだった。
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true';
      // ref の存在確認: master 系だけ存在しない
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        return args[3].includes('master') ? '' : 'abc1234';
      }
      // 作業ツリーはクリーン、直近コミットも無い
      if (args[0] === 'diff' || args[0] === 'status' || args[0] === 'log') return '';
      if (args[0] === 'rev-list') {
        // 存在しない ref が渡されたら git は落ちる — それを再現する
        if (args.some((a) => a.includes('master'))) throw new Error('fatal: ambiguous argument');
        return '1';
      }
      return '';
    });

    expect(await checkGitDiff(WORK_DIR, LOG_PREFIX)).toBe(true);
  });

  it('base ref の rev-parse --verify 呼び出しには skipLog: true が渡される（存在しない候補refでERRORログを出さない）', async () => {
    // task 693: origin/master・master のようにこのリポジトリに存在しない候補refを
    // 探索する呼び出しは、失敗しても呼び出し元が .catch(() => '') で握り潰す想定内の
    // 失敗である。skipLog が付いていないと github-service:git-exec が毎回 ERROR ログを出す。
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true';
      if (args[0] === 'rev-parse' && args[1] === '--verify') return '';
      return '';
    });
    await checkGitDiff(WORK_DIR, LOG_PREFIX);
    const verifyCalls = mockRunGitCommand.mock.calls.filter(
      (call) => (call[0] as string[])[0] === 'rev-parse' && (call[0] as string[])[1] === '--verify',
    );
    expect(verifyCalls.length).toBeGreaterThan(0);
    for (const call of verifyCalls) {
      const opts = call[2] as { skipLog?: boolean } | undefined;
      expect(opts?.skipLog).toBe(true);
    }
  });

  it('base ref が1つも存在しない場合は branch commit 判定をスキップする', async () => {
    mockRunGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true';
      if (args[0] === 'rev-parse' && args[1] === '--verify') return '';
      if (args[0] === 'rev-list') throw new Error('should not be called');
      return '';
    });

    expect(await checkGitDiff(WORK_DIR, LOG_PREFIX)).toBe(false);
  });
});
