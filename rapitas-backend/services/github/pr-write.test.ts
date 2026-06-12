/**
 * pr-write.test
 *
 * Tests for PR write operations, focusing on mergePullRequest's
 * --auto fallback logic: when GitHub doesn't support auto-merge,
 * the function must retry without --auto and log a warning.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock declarations are hoisted by bun before static imports.
const mockRunGhCommand = mock((_args: string[], _cwd?: string, _opts?: { skipLog?: boolean }) => Promise.resolve(''));

mock.module('./gh-client', () => ({
  runGhCommand: mockRunGhCommand,
}));

// Import after mocking so the module picks up the mock.
const { mergePullRequest } = await import('./pr-write');

describe('mergePullRequest', () => {
  beforeEach(() => {
    mockRunGhCommand.mockReset();
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

      const [, , opts] = mockRunGhCommand.mock.calls[0] as [string[], string | undefined, { skipLog?: boolean } | undefined];
      expect(opts?.skipLog).toBe(true);
    });

    it('falls back to direct merge when auto-merge is not allowed, returns autoQueued: false', async () => {
      // First call (--auto) fails with the GitHub "not allowed" message.
      mockRunGhCommand.mockRejectedValueOnce(
        new Error('GraphQL: Auto-merge is not allowed for this repository (addPullRequestToMergeQueue)'),
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

      await expect(mergePullRequest('owner/repo', 7, { auto: true })).rejects.toBe(directMergeError);
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
