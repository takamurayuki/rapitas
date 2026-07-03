/**
 * core-ops-diff.test
 *
 * Covers getGitDiff and getFullGitDiff: success formatting and the
 * catch-to-empty-string fallback when the underlying git command fails.
 * Commit-side core-ops behaviour lives in core-ops-commit.test.ts.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// child_process mock — scripted execFile, matched by joined "file arg1 arg2..."
// command string. Both specifiers and both exports are mirrored because
// core-ops.ts re-exports getDiff from diff-structured.ts, which is still
// evaluated (pulling in its own `import { exec } from 'child_process'` and
// `promisify(exec)` at module load) even though these tests never call getDiff.
// ---------------------------------------------------------------------------

let script: Array<{ match: RegExp; result: string | Error }> = [];

function runScripted(file: string, args: string[]): { stdout: string; stderr: string } {
  const cmd = [file, ...args].join(' ');
  for (const s of script) {
    if (s.match.test(cmd)) {
      if (s.result instanceof Error) throw s.result;
      return { stdout: s.result, stderr: '' };
    }
  }
  return { stdout: '', stderr: '' };
}

const execFileMockImpl = (
  file: string,
  args: unknown,
  optsOrCb: unknown,
  cb?: (e: Error | null, r?: unknown) => void,
) => {
  const argv = Array.isArray(args) ? (args as string[]) : [];
  const callback = (typeof optsOrCb === 'function' ? optsOrCb : cb) as (
    e: Error | null,
    r?: unknown,
  ) => void;
  try {
    callback(null, runScripted(file, argv));
  } catch (err) {
    callback(err as Error);
  }
};
// NOTE: diff-structured.ts uses the shell-string `exec`, not `execFile`; stub it
// so its module-level `promisify(exec)` does not receive `undefined`.
const execMockImpl = (
  cmd: string,
  optsOrCb: unknown,
  cb?: (e: Error | null, r?: unknown) => void,
) => {
  const callback = (typeof optsOrCb === 'function' ? optsOrCb : cb) as (
    e: Error | null,
    r?: unknown,
  ) => void;
  try {
    callback(null, runScripted(cmd, []));
  } catch (err) {
    callback(err as Error);
  }
};
mock.module('child_process', () => ({ execFile: execFileMockImpl, exec: execMockImpl }));
mock.module('node:child_process', () => ({ execFile: execFileMockImpl, exec: execMockImpl }));

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

// core-ops.ts imports ensureNotPrimaryWorkTree even though getGitDiff/getFullGitDiff
// never call it; stub the whole module so it never touches real git.
mock.module('./worktree-guard', () => ({
  isPrimaryWorkTree: async () => false,
  isBackendPrimaryCheckout: async () => false,
  findConflictingWorktreeForBranch: async () => null,
  ensureNotPrimaryWorkTree: async () => {},
}));

const { getGitDiff, getFullGitDiff } = await import('./core-ops');

beforeEach(() => {
  script = [];
});

describe('getGitDiff', () => {
  test('returns stdout on success', async () => {
    script = [{ match: /^git diff$/, result: 'diff --git a/x b/x\n+added\n' }];
    const diff = await getGitDiff('/repo');
    expect(diff).toBe('diff --git a/x b/x\n+added\n');
  });

  test('returns empty string when git fails', async () => {
    script = [{ match: /^git diff$/, result: new Error('not a git repository') }];
    const diff = await getGitDiff('/repo');
    expect(diff).toBe('');
  });
});

describe('getFullGitDiff', () => {
  test('combines staged, unstaged, and untracked sections', async () => {
    script = [
      { match: /^git diff --cached$/, result: 'staged-diff\n' },
      { match: /^git diff$/, result: 'unstaged-diff\n' },
      { match: /^git ls-files --others --exclude-standard$/, result: 'new-file.ts\n' },
    ];
    const diff = await getFullGitDiff('/repo');
    expect(diff).toContain('=== Staged Changes ===\nstaged-diff');
    expect(diff).toContain('=== Unstaged Changes ===\nunstaged-diff');
    expect(diff).toContain('=== New Files ===\nnew-file.ts');
  });

  test('returns "No changes detected" when everything is empty', async () => {
    script = [
      { match: /^git diff --cached$/, result: '' },
      { match: /^git diff$/, result: '' },
      { match: /^git ls-files --others --exclude-standard$/, result: '' },
    ];
    const diff = await getFullGitDiff('/repo');
    expect(diff).toBe('No changes detected');
  });

  test('returns empty string when a git command fails', async () => {
    script = [{ match: /^git diff --cached$/, result: new Error('fatal: not a repo') }];
    const diff = await getFullGitDiff('/repo');
    expect(diff).toBe('');
  });
});
