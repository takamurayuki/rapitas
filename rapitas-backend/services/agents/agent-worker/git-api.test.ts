/**
 * Tests for agent-worker git-api
 *
 * All functions here are thin delegators to an injected IpcSender — no real
 * git or child_process is ever invoked. Each test asserts the IPC call shape
 * (type, payload, timeout) and that the resolved/rejected value passes through
 * unchanged.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import {
  createBranch,
  createWorktree,
  removeWorktree,
  cleanupStaleWorktrees,
  createCommit,
  createPullRequest,
  mergePullRequest,
  getGitDiff,
  getFullGitDiff,
  getDiff,
  revertChanges,
  commitChanges,
} from './git-api';
import type { IpcSender } from './public-api';

let ipcMock: ReturnType<typeof mock>;
let ipc: IpcSender;

beforeEach(() => {
  ipcMock = mock((_type: string, _data: Record<string, unknown>, _timeoutMs?: number) =>
    Promise.resolve(undefined),
  );
  ipc = ipcMock as unknown as IpcSender;
});

describe('createBranch', () => {
  test('delegates to ipc with a 30s timeout and returns the result', async () => {
    ipcMock.mockResolvedValue(true);

    const result = await createBranch(ipc, '/repo', 'feature/x');

    expect(result).toBe(true);
    expect(ipcMock).toHaveBeenCalledWith(
      'create-branch',
      { workingDirectory: '/repo', branchName: 'feature/x' },
      30000,
    );
  });

  test('propagates ipc rejection', async () => {
    ipcMock.mockRejectedValue(new Error('worker down'));

    await expect(createBranch(ipc, '/repo', 'feature/x')).rejects.toThrow('worker down');
  });
});

describe('createWorktree', () => {
  test('passes all params through with a 10 minute timeout', async () => {
    ipcMock.mockResolvedValue('/repo-worktrees/task-9');

    const result = await createWorktree(
      ipc,
      '/repo',
      'feature/x',
      9,
      'git@github.com:o/r.git',
      'develop',
    );

    expect(result).toBe('/repo-worktrees/task-9');
    expect(ipcMock).toHaveBeenCalledWith(
      'create-worktree',
      {
        baseDir: '/repo',
        branchName: 'feature/x',
        taskId: 9,
        repositoryUrl: 'git@github.com:o/r.git',
        baseBranch: 'develop',
      },
      10 * 60 * 1000,
    );
  });

  test('optional params default to undefined when omitted', async () => {
    ipcMock.mockResolvedValue('/repo-worktrees/task-none');

    await createWorktree(ipc, '/repo', 'feature/x');

    expect(ipcMock).toHaveBeenCalledWith(
      'create-worktree',
      {
        baseDir: '/repo',
        branchName: 'feature/x',
        taskId: undefined,
        repositoryUrl: undefined,
        baseBranch: undefined,
      },
      10 * 60 * 1000,
    );
  });
});

describe('removeWorktree', () => {
  test('delegates to ipc with a 5 minute timeout and no return value', async () => {
    ipcMock.mockResolvedValue(undefined);

    const result = await removeWorktree(ipc, '/repo', '/repo-worktrees/task-9');

    expect(result).toBeUndefined();
    expect(ipcMock).toHaveBeenCalledWith(
      'remove-worktree',
      { baseDir: '/repo', worktreePath: '/repo-worktrees/task-9' },
      5 * 60 * 1000,
    );
  });
});

describe('cleanupStaleWorktrees', () => {
  test('delegates to ipc with a 10 minute timeout and returns the cleaned count', async () => {
    ipcMock.mockResolvedValue(3);

    const result = await cleanupStaleWorktrees(ipc, '/repo');

    expect(result).toBe(3);
    expect(ipcMock).toHaveBeenCalledWith(
      'cleanup-stale-worktrees',
      { baseDir: '/repo', keepPaths: [] },
      10 * 60 * 1000,
    );
  });

  test('live-task keep paths travel to the worker in the ipc payload', async () => {
    ipcMock.mockResolvedValue(0);

    await cleanupStaleWorktrees(ipc, '/repo', ['/repo/.worktrees/task-494-aaaa']);

    expect(ipcMock).toHaveBeenCalledWith(
      'cleanup-stale-worktrees',
      { baseDir: '/repo', keepPaths: ['/repo/.worktrees/task-494-aaaa'] },
      10 * 60 * 1000,
    );
  });
});

describe('createCommit', () => {
  test('delegates to ipc with a 30s timeout and returns commit metadata', async () => {
    const commitResult = {
      hash: 'abc123',
      branch: 'feature/x',
      filesChanged: 2,
      additions: 10,
      deletions: 1,
    };
    ipcMock.mockResolvedValue(commitResult);

    const result = await createCommit(ipc, '/repo', 'fix: bug');

    expect(result).toEqual(commitResult);
    expect(ipcMock).toHaveBeenCalledWith(
      'create-commit',
      { workingDirectory: '/repo', message: 'fix: bug' },
      30000,
    );
  });
});

describe('createPullRequest', () => {
  test('defaults baseBranch to main when omitted', async () => {
    ipcMock.mockResolvedValue({ success: true, prUrl: 'https://x', prNumber: 1 });

    const result = await createPullRequest(ipc, '/repo', 'title', 'body');

    expect(result).toEqual({ success: true, prUrl: 'https://x', prNumber: 1 });
    expect(ipcMock).toHaveBeenCalledWith(
      'create-pull-request',
      { workingDirectory: '/repo', title: 'title', body: 'body', baseBranch: 'main' },
      60000,
    );
  });

  test('honors an explicit baseBranch and surfaces a failure result', async () => {
    ipcMock.mockResolvedValue({ success: false, error: 'no diff' });

    const result = await createPullRequest(ipc, '/repo', 'title', 'body', 'develop');

    expect(result).toEqual({ success: false, error: 'no diff' });
    expect(ipcMock).toHaveBeenCalledWith(
      'create-pull-request',
      { workingDirectory: '/repo', title: 'title', body: 'body', baseBranch: 'develop' },
      60000,
    );
  });
});

describe('mergePullRequest', () => {
  test('defaults commitThreshold to 5 and baseBranch to master when omitted', async () => {
    ipcMock.mockResolvedValue({ success: true, mergeStrategy: 'squash' });

    const result = await mergePullRequest(ipc, '/repo', 42);

    expect(result).toEqual({ success: true, mergeStrategy: 'squash' });
    expect(ipcMock).toHaveBeenCalledWith(
      'merge-pull-request',
      { workingDirectory: '/repo', prNumber: 42, commitThreshold: 5, baseBranch: 'master' },
      60000,
    );
  });

  test('honors explicit commitThreshold and baseBranch', async () => {
    ipcMock.mockResolvedValue({ success: false, error: 'conflict' });

    const result = await mergePullRequest(ipc, '/repo', 42, 2, 'main');

    expect(result).toEqual({ success: false, error: 'conflict' });
    expect(ipcMock).toHaveBeenCalledWith(
      'merge-pull-request',
      { workingDirectory: '/repo', prNumber: 42, commitThreshold: 2, baseBranch: 'main' },
      60000,
    );
  });
});

describe('getGitDiff', () => {
  test('delegates to ipc with a 10s timeout and returns the diff string', async () => {
    ipcMock.mockResolvedValue('diff --git a b');

    const result = await getGitDiff(ipc, '/repo');

    expect(result).toBe('diff --git a b');
    expect(ipcMock).toHaveBeenCalledWith('get-git-diff', { workingDirectory: '/repo' }, 10000);
  });
});

describe('getFullGitDiff', () => {
  test('delegates to ipc with a 10s timeout and returns the diff string', async () => {
    ipcMock.mockResolvedValue('full diff');

    const result = await getFullGitDiff(ipc, '/repo');

    expect(result).toBe('full diff');
    expect(ipcMock).toHaveBeenCalledWith('get-full-git-diff', { workingDirectory: '/repo' }, 10000);
  });
});

describe('getDiff', () => {
  test('delegates to ipc with a 10s timeout and returns structured file diffs', async () => {
    const files = [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0 }];
    ipcMock.mockResolvedValue(files);

    const result = await getDiff(ipc, '/repo');

    expect(result).toEqual(files);
    expect(ipcMock).toHaveBeenCalledWith('get-diff', { workingDirectory: '/repo' }, 10000);
  });
});

describe('revertChanges', () => {
  test('delegates to ipc with a 10s timeout and returns success boolean', async () => {
    ipcMock.mockResolvedValue(true);

    const result = await revertChanges(ipc, '/repo');

    expect(result).toBe(true);
    expect(ipcMock).toHaveBeenCalledWith('revert-changes', { workingDirectory: '/repo' }, 10000);
  });
});

describe('commitChanges', () => {
  test('delegates to ipc with a 30s timeout including an optional taskTitle', async () => {
    ipcMock.mockResolvedValue({ success: true, commitHash: 'deadbeef' });

    const result = await commitChanges(ipc, '/repo', 'fix: bug', 'Fix the bug');

    expect(result).toEqual({ success: true, commitHash: 'deadbeef' });
    expect(ipcMock).toHaveBeenCalledWith(
      'commit-changes',
      { workingDirectory: '/repo', message: 'fix: bug', taskTitle: 'Fix the bug' },
      30000,
    );
  });

  test('taskTitle defaults to undefined and a failure result surfaces the error', async () => {
    ipcMock.mockResolvedValue({ success: false, error: 'nothing to commit' });

    const result = await commitChanges(ipc, '/repo', 'fix: bug');

    expect(result).toEqual({ success: false, error: 'nothing to commit' });
    expect(ipcMock).toHaveBeenCalledWith(
      'commit-changes',
      { workingDirectory: '/repo', message: 'fix: bug', taskTitle: undefined },
      30000,
    );
  });
});
