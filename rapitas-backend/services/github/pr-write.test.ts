/**
 * pr-write.test
 *
 * Tests for PR write operations:
 * - mergePullRequest --auto fallback logic
 * - createPullRequestComment, approvePullRequest, requestChanges, createPullRequest
 *   each use runGhCommandWithBody (not runGhCommand) for dynamic body content
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock declarations are hoisted by bun before static imports.
const mockRunGhCommand = mock((_args: string[], _cwd?: string, _opts?: { skipLog?: boolean }) =>
  Promise.resolve(''),
);
const mockRunGhCommandWithBody = mock(
  (_args: string[], _body?: string, _cwd?: string, _opts?: { skipLog?: boolean }) =>
    Promise.resolve(''),
);

mock.module('./gh-client', () => ({
  runGhCommand: mockRunGhCommand,
  runGhCommandWithBody: mockRunGhCommandWithBody,
}));

// exec is used by createPullRequest (git push) and syncLocalBranchWithRemote
let execShouldFail = false;
const mockExec = mock(
  (
    _cmd: string,
    _opts: object,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    if (execShouldFail) {
      cb(new Error('git push failed'));
    } else {
      cb(null, { stdout: '', stderr: '' });
    }
  },
);

// NOTE: Include execFile as well to prevent "export not found" when gh-client.test.ts
// runs in the same process (bun mock.module is process-global).
mock.module('child_process', () => ({
  exec: mockExec,
  execFile: mock(() => {}),
}));

// Import after mocking so the modules pick up the mocks.
const {
  mergePullRequest,
  createPullRequestComment,
  approvePullRequest,
  requestChanges,
  createPullRequest,
} = await import('./pr-write');

// ─── mergePullRequest ─────────────────────────────────────────────────────────

describe('mergePullRequest', () => {
  beforeEach(() => {
    mockRunGhCommand.mockReset();
    mockRunGhCommandWithBody.mockReset();
  });

  describe('without auto option', () => {
    it('calls gh pr merge without --auto and returns autoQueued: false', async () => {
      mockRunGhCommand.mockResolvedValueOnce('');

      const result = await mergePullRequest('owner/repo', 42, { method: 'squash' });

      expect(result).toEqual({ autoQueued: false });
      expect(mockRunGhCommand).toHaveBeenCalledTimes(1);
      const [args] = mockRunGhCommand.mock.calls[0] as [string[]];
      expect(args).toContain('42');
      expect(args).toContain('--squash');
      expect(args).not.toContain('--auto');
    });

    it('includes --delete-branch when deleteBranch: true', async () => {
      mockRunGhCommand.mockResolvedValueOnce('');

      await mergePullRequest('owner/repo', 1, { deleteBranch: true });

      const [args] = mockRunGhCommand.mock.calls[0] as [string[]];
      expect(args).toContain('--delete-branch');
    });

    it('defaults to squash merge method', async () => {
      mockRunGhCommand.mockResolvedValueOnce('');

      await mergePullRequest('owner/repo', 1);

      const [args] = mockRunGhCommand.mock.calls[0] as [string[]];
      expect(args).toContain('--squash');
    });
  });

  describe('with auto: true', () => {
    it('calls gh pr merge with --auto and returns autoQueued: true on success', async () => {
      mockRunGhCommand.mockResolvedValueOnce('');

      const result = await mergePullRequest('owner/repo', 7, { auto: true });

      expect(result).toEqual({ autoQueued: true });
      expect(mockRunGhCommand).toHaveBeenCalledTimes(1);
      const [args] = mockRunGhCommand.mock.calls[0] as [string[]];
      expect(args).toContain('--auto');
    });

    it('passes skipLog: true for the --auto attempt to suppress spurious ERROR logs', async () => {
      mockRunGhCommand.mockResolvedValueOnce('');

      await mergePullRequest('owner/repo', 7, { auto: true });

      const [, , opts] = mockRunGhCommand.mock.calls[0] as [
        string[],
        string | undefined,
        { skipLog?: boolean } | undefined,
      ];
      expect(opts?.skipLog).toBe(true);
    });

    it('falls back to direct merge when auto-merge is not allowed, returns autoQueued: false', async () => {
      // First call (--auto) fails with the GitHub "not allowed" message.
      mockRunGhCommand.mockRejectedValueOnce(
        new Error(
          'GraphQL: Auto-merge is not allowed for this repository (addPullRequestToMergeQueue)',
        ),
      );
      // Second call (direct merge) succeeds.
      mockRunGhCommand.mockResolvedValueOnce('');

      const result = await mergePullRequest('owner/repo', 7, { auto: true });

      expect(result).toEqual({ autoQueued: false });
      expect(mockRunGhCommand).toHaveBeenCalledTimes(2);

      const [firstArgs] = mockRunGhCommand.mock.calls[0] as [string[]];
      expect(firstArgs).toContain('--auto');

      const [secondArgs] = mockRunGhCommand.mock.calls[1] as [string[]];
      expect(secondArgs).not.toContain('--auto');
    });

    it('falls back when "not in a state that can be auto merged" error occurs', async () => {
      mockRunGhCommand.mockRejectedValueOnce(
        new Error('Pull request #7 is not in a state that can be auto merged'),
      );
      mockRunGhCommand.mockResolvedValueOnce('');

      const result = await mergePullRequest('owner/repo', 7, { auto: true });

      expect(result).toEqual({ autoQueued: false });
      expect(mockRunGhCommand).toHaveBeenCalledTimes(2);
    });

    it('propagates unrelated errors without retrying', async () => {
      const conflictError = new Error('Pull request is not mergeable due to merge conflicts');
      mockRunGhCommand.mockRejectedValueOnce(conflictError);

      await expect(mergePullRequest('owner/repo', 7, { auto: true })).rejects.toBe(conflictError);
      // Only one attempt — no retry for unrelated failures.
      expect(mockRunGhCommand).toHaveBeenCalledTimes(1);
    });

    it('propagates the error when fallback direct merge also fails', async () => {
      mockRunGhCommand.mockRejectedValueOnce(
        new Error('Auto-merge is not allowed for this repository'),
      );
      const directMergeError = new Error('Pull request is not mergeable');
      mockRunGhCommand.mockRejectedValueOnce(directMergeError);

      await expect(mergePullRequest('owner/repo', 7, { auto: true })).rejects.toBe(
        directMergeError,
      );
      expect(mockRunGhCommand).toHaveBeenCalledTimes(2);
    });

    it('preserves --delete-branch in fallback args', async () => {
      mockRunGhCommand.mockRejectedValueOnce(
        new Error('Auto-merge is not allowed for this repository'),
      );
      mockRunGhCommand.mockResolvedValueOnce('');

      await mergePullRequest('owner/repo', 7, { auto: true, deleteBranch: true });

      const [fallbackArgs] = mockRunGhCommand.mock.calls[1] as [string[]];
      expect(fallbackArgs).toContain('--delete-branch');
      expect(fallbackArgs).not.toContain('--auto');
    });
  });
});

// ─── createPullRequestComment ─────────────────────────────────────────────────

describe('createPullRequestComment', () => {
  beforeEach(() => {
    mockRunGhCommand.mockReset();
    mockRunGhCommandWithBody.mockReset();
  });

  it('一般コメント: runGhCommandWithBody を使い --body を付与しない', async () => {
    mockRunGhCommandWithBody.mockResolvedValueOnce('');

    const result = await createPullRequestComment('owner/repo', 10, {
      body: '改行あり\nコメント',
    });

    expect(result.body).toBe('改行あり\nコメント');
    expect(mockRunGhCommandWithBody).toHaveBeenCalledTimes(1);
    const [args, body] = mockRunGhCommandWithBody.mock.calls[0] as [string[], string];
    expect(args).toContain('pr');
    expect(args).toContain('comment');
    expect(args).toContain('10');
    expect(args).not.toContain('--body');
    expect(body).toBe('改行あり\nコメント');
  });
});

// ─── approvePullRequest ───────────────────────────────────────────────────────

describe('approvePullRequest', () => {
  beforeEach(() => {
    mockRunGhCommandWithBody.mockReset();
  });

  it('body あり: runGhCommandWithBody に body を渡す', async () => {
    mockRunGhCommandWithBody.mockResolvedValueOnce('');

    await approvePullRequest('owner/repo', 5, 'LGTM\n詳細コメント');

    const [args, body] = mockRunGhCommandWithBody.mock.calls[0] as [string[], string | undefined];
    expect(args).toContain('--approve');
    expect(args).not.toContain('--body');
    expect(body).toBe('LGTM\n詳細コメント');
  });

  it('body なし: runGhCommandWithBody に undefined を渡す', async () => {
    mockRunGhCommandWithBody.mockResolvedValueOnce('');

    await approvePullRequest('owner/repo', 5);

    const [, body] = mockRunGhCommandWithBody.mock.calls[0] as [string[], string | undefined];
    expect(body).toBeUndefined();
  });
});

// ─── requestChanges ───────────────────────────────────────────────────────────

describe('requestChanges', () => {
  beforeEach(() => {
    mockRunGhCommandWithBody.mockReset();
  });

  it('runGhCommandWithBody を使い --request-changes に body を渡す', async () => {
    mockRunGhCommandWithBody.mockResolvedValueOnce('');

    await requestChanges('owner/repo', 7, '変更が必要です\n詳細: ...');

    expect(mockRunGhCommandWithBody).toHaveBeenCalledTimes(1);
    const [args, body] = mockRunGhCommandWithBody.mock.calls[0] as [string[], string];
    expect(args).toContain('--request-changes');
    expect(args).not.toContain('--body');
    expect(body).toBe('変更が必要です\n詳細: ...');
  });
});

// ─── createPullRequest ────────────────────────────────────────────────────────

describe('createPullRequest', () => {
  beforeEach(() => {
    mockRunGhCommandWithBody.mockReset();
    mockExec.mockClear();
    execShouldFail = false;
  });

  it('正常系: git push 後に runGhCommandWithBody で PR を作成し success を返す', async () => {
    const prUrl = 'https://github.com/owner/repo/pull/99';
    mockRunGhCommandWithBody.mockResolvedValueOnce(prUrl);

    const result = await createPullRequest(
      '/workspace',
      'feature/test',
      'develop',
      '[#42] テスト PR',
      '## Summary\n日本語PR本文\n\nCloses #42',
    );

    expect(result.success).toBe(true);
    expect(result.prUrl).toBe(prUrl);
    expect(result.prNumber).toBe(99);
    expect(mockRunGhCommandWithBody).toHaveBeenCalledTimes(1);
    const [args, body, cwd] = mockRunGhCommandWithBody.mock.calls[0] as [string[], string, string];
    expect(args).toContain('pr');
    expect(args).toContain('create');
    expect(args).toContain('--title');
    expect(args).not.toContain('--body');
    expect(body).toBe('## Summary\n日本語PR本文\n\nCloses #42');
    expect(cwd).toBe('/workspace');
  });

  it('git push 失敗 → success: false でエラーメッセージを返す', async () => {
    execShouldFail = true;

    const result = await createPullRequest(
      '/workspace',
      'feature/test',
      'develop',
      'PR title',
      'PR body',
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(mockRunGhCommandWithBody).not.toHaveBeenCalled();
  });
});
