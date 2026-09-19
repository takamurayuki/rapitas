/**
 * continuation-pr-detect.test
 *
 * Coverage for detectAndLinkContinuationPr: happy path (branch has a new open
 * PR, both ownership gates agree, linkAutoCreatedPr is called), the "no PR"
 * / "no branch" no-ops, the branch-marker and title/body-marker mismatch
 * refusals, and gh CLI failure being swallowed rather than thrown.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let capturedArgs: string[] = [];
let shouldGhFail = false;
let ghStdout = 'null';

const mockExecFile = mock(
  (
    _bin: string,
    args: string[],
    _opts: object,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    capturedArgs = [...args];
    if (shouldGhFail) {
      cb(Object.assign(new Error('gh: timeout'), { stderr: 'gh: timeout' }));
    } else {
      cb(null, { stdout: ghStdout, stderr: '' });
    }
  },
);

// NOTE: Mirror ALL exports other in-process modules pull from 'child_process'
// (bun mock.module is process-global) — only execFile is used here; the rest
// are no-ops present so a sibling module's import doesn't hit "export not found".
mock.module('child_process', () => ({
  execFile: mockExecFile,
  exec: mock(() => {}),
  execSync: mock(() => ''),
  spawn: mock(() => ({ on: mock(() => {}), stdout: null, stderr: null })),
  spawnSync: mock(() => ({ status: 0, stdout: '', stderr: '' })),
  fork: mock(() => ({ on: mock(() => {}) })),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  }),
}));

const linkAutoCreatedPrMock = mock((..._args: unknown[]) => Promise.resolve(999));
mock.module('./pr-link', () => ({
  linkAutoCreatedPr: linkAutoCreatedPrMock,
  resolveIntegrationId: mock(() => Promise.resolve(1)),
}));

const { detectAndLinkContinuationPr } = await import('./continuation-pr-detect');

const mockPrisma = {} as never;

beforeEach(() => {
  capturedArgs = [];
  shouldGhFail = false;
  ghStdout = 'null';
  linkAutoCreatedPrMock.mockClear();
});

describe('detectAndLinkContinuationPr', () => {
  it('links a new open PR whose branch/title/body markers agree with the task', async () => {
    ghStdout = JSON.stringify({
      number: 42,
      url: 'https://github.com/o/r/pull/42',
      baseRefName: 'develop',
      title: '[#951] Fix PR linking',
      body: 'closes #951',
    });

    const result = await detectAndLinkContinuationPr(mockPrisma, {
      taskId: 951,
      taskTitle: 'Fix PR linking',
      branchName: 'bugfix/t951-update-agent',
      workingDirectory: '/repo',
    });

    expect(result).toBe(999);
    expect(linkAutoCreatedPrMock).toHaveBeenCalledTimes(1);
    const call = linkAutoCreatedPrMock.mock.calls[0][1] as {
      taskId: number;
      prNumber: number;
      headBranch: string;
      baseBranch: string;
    };
    expect(call).toMatchObject({
      taskId: 951,
      prNumber: 42,
      headBranch: 'bugfix/t951-update-agent',
      baseBranch: 'develop',
    });
    expect(capturedArgs).toContain('--head');
  });

  it('returns null and skips the gh call when branchName is null', async () => {
    const result = await detectAndLinkContinuationPr(mockPrisma, {
      taskId: 951,
      taskTitle: 'Fix PR linking',
      branchName: null,
      workingDirectory: '/repo',
    });

    expect(result).toBeNull();
    expect(capturedArgs).toEqual([]);
    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });

  it('returns null when gh pr list finds no open PR on the branch', async () => {
    ghStdout = 'null';

    const result = await detectAndLinkContinuationPr(mockPrisma, {
      taskId: 951,
      taskTitle: 'Fix PR linking',
      branchName: 'bugfix/t951-update-agent',
      workingDirectory: '/repo',
    });

    expect(result).toBeNull();
    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });

  it('refuses to link when the branch name does not carry the task marker', async () => {
    ghStdout = JSON.stringify({
      number: 42,
      url: 'https://github.com/o/r/pull/42',
      baseRefName: 'develop',
      title: 'unrelated title',
      body: null,
    });

    const result = await detectAndLinkContinuationPr(mockPrisma, {
      taskId: 951,
      taskTitle: 'Fix PR linking',
      branchName: 'some-manual-branch',
      workingDirectory: '/repo',
    });

    expect(result).toBeNull();
    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });

  it('refuses to link when the PR title marker names a different task', async () => {
    ghStdout = JSON.stringify({
      number: 42,
      url: 'https://github.com/o/r/pull/42',
      baseRefName: 'develop',
      title: '[#123] Some other task',
      body: null,
    });

    const result = await detectAndLinkContinuationPr(mockPrisma, {
      taskId: 951,
      taskTitle: 'Fix PR linking',
      branchName: 'bugfix/t951-update-agent',
      workingDirectory: '/repo',
    });

    expect(result).toBeNull();
    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });

  it('swallows a gh CLI timeout/failure and returns null instead of throwing', async () => {
    shouldGhFail = true;

    const result = await detectAndLinkContinuationPr(mockPrisma, {
      taskId: 951,
      taskTitle: 'Fix PR linking',
      branchName: 'bugfix/t951-update-agent',
      workingDirectory: '/repo',
    });

    expect(result).toBeNull();
    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });
});
