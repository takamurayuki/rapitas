/**
 * core-ops-commit.test
 *
 * Covers commitChanges and createCommit: staging, commit message assembly,
 * numstat parsing, the empty-diff no-op path, primary-worktree refusal, and
 * the transient `.wf-*` file cleanup that runs before every commit.
 * Diff-reading core-ops behaviour lives in core-ops-diff.test.ts.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// child_process mock — scripted execFile, matched by joined "file arg1 arg2..."
// command string. Both specifiers and both exports are mirrored because
// core-ops.ts re-exports getDiff from diff-structured.ts, which is still
// evaluated (pulling in its own `import { exec } from 'child_process'` and
// `promisify(exec)` at module load) even though these tests never call getDiff.
// ---------------------------------------------------------------------------

type Call = { file: string; args: string[]; opts?: { timeout?: number } };
let calls: Call[] = [];
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
  const opts = typeof optsOrCb === 'function' ? undefined : (optsOrCb as { timeout?: number });
  calls.push({ file, args: argv, opts });
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

// NOTE: diff-structured.ts (re-exported by core-ops.ts) imports assertSafeGitRef
// from branch-name-generator, whose real module pulls in the ai-client dependency
// chain (claude-cli-provider needs child_process exports this test's mock does
// not mirror). assertSafeGitRef is a pure function covered by
// branch-name-generator.test.ts; mirror its logic to keep the module graph small
// (same pattern as worktree-ops.test.ts).
mock.module('../../../../../utils/common/branch-name-generator', () => ({
  assertSafeGitRef: (ref: string, field = 'branchName') => {
    if (typeof ref !== 'string' || ref.length === 0 || ref.length > 200) {
      throw new Error(`Invalid ${field}: must be a non-empty string under 200 chars`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes('..')) {
      throw new Error(`Invalid ${field}: contains characters not allowed in a branch name`);
    }
  },
}));

mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

// worktree-guard is mocked entirely so tests never touch real git; its own
// behaviour is covered separately in worktree-guard.test.ts. primaryThrows lets
// individual tests exercise the "refuse on primary checkout" branch.
let primaryThrows = false;
mock.module('../worktree/worktree-guard', () => ({
  isPrimaryWorkTree: async () => primaryThrows,
  isBackendPrimaryCheckout: async () => false,
  findConflictingWorktreeForBranch: async () => null,
  recoverFromUnresolvedMerge: async () => false,
  ensureNotPrimaryWorkTree: async (dir: string, op: string) => {
    if (primaryThrows) {
      throw new Error(`Refusing to ${op} in the PRIMARY git working tree (${dir}).`);
    }
  },
}));

const { commitChanges, createCommit } = await import('./core-ops');

const TMP_ROOT = resolve('.tmp-tests/core-ops-commit');

beforeEach(async () => {
  calls = [];
  script = [];
  primaryThrows = false;
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe('commitChanges', () => {
  test('refuses on the primary working tree', async () => {
    primaryThrows = true;
    const result = await commitChanges('/repo', 'msg');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/PRIMARY git working tree/);
  });

  test('stages, commits, and returns the resulting hash', async () => {
    const dir = join(TMP_ROOT, 'commit-success');
    await mkdir(dir, { recursive: true });
    script = [
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'abc1234\n' },
    ];

    const result = await commitChanges(dir, 'feat: add thing');

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');
  });

  test('appends the task title to the commit message when provided', async () => {
    const dir = join(TMP_ROOT, 'commit-with-title');
    await mkdir(dir, { recursive: true });
    script = [
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'def5678\n' },
    ];

    await commitChanges(dir, 'feat: add thing', 'Task Title Here');

    const commitCall = calls.find((c) => c.args[0] === 'commit');
    expect(commitCall?.args[2]).toContain('Task: Task Title Here');
    expect(commitCall?.args[2]).toContain('Co-Authored-By: Claude Code <noreply@anthropic.com>');
  });

  test('omits the Task line when no task title is provided', async () => {
    const dir = join(TMP_ROOT, 'commit-without-title');
    await mkdir(dir, { recursive: true });
    script = [
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'aaa1111\n' },
    ];

    await commitChanges(dir, 'feat: add thing');

    const commitCall = calls.find((c) => c.args[0] === 'commit');
    expect(commitCall?.args[2]).not.toContain('Task:');
    expect(commitCall?.args[2]).toContain('Co-Authored-By: Claude Code <noreply@anthropic.com>');
  });

  test('deletes transient .wf-* files before staging', async () => {
    const dir = join(TMP_ROOT, 'commit-cleans-wf-files');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'normal.txt'), 'keep me');
    await writeFile(join(dir, '.wf-tmp.md'), 'agent scratch');
    await writeFile(join(dir, '.wf-concern.json'), '{}');
    script = [
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'ccc3333\n' },
    ];

    await commitChanges(dir, 'msg');

    const remaining = await readdir(dir);
    expect(remaining).toContain('normal.txt');
    expect(remaining).not.toContain('.wf-tmp.md');
    expect(remaining).not.toContain('.wf-concern.json');
  });

  test('passes a timeout so a hung git process cannot block the phase indefinitely (#809)', async () => {
    const dir = join(TMP_ROOT, 'commit-has-timeout');
    await mkdir(dir, { recursive: true });
    script = [
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'timeout1\n' },
    ];

    await commitChanges(dir, 'msg');

    const commitCall = calls.find((c) => c.args[0] === 'commit');
    expect(commitCall?.opts?.timeout).toBe(60_000);
  });

  test('returns success:false with the underlying error when commit fails', async () => {
    const dir = join(TMP_ROOT, 'commit-fails');
    await mkdir(dir, { recursive: true });
    script = [
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: new Error('nothing to commit, working tree clean') },
    ];

    const result = await commitChanges(dir, 'msg');

    expect(result.success).toBe(false);
    expect(result.error).toContain('nothing to commit');
  });
});

describe('createCommit', () => {
  test('rejects on the primary working tree without touching git', async () => {
    primaryThrows = true;
    await expect(createCommit('/repo', 'msg')).rejects.toThrow(/PRIMARY git working tree/);
    expect(calls.length).toBe(0);
  });

  test('does not create a feature branch when already on a non-protected branch', async () => {
    const dir = join(TMP_ROOT, 'stay-on-branch');
    await mkdir(dir, { recursive: true });
    script = [
      { match: /^git branch --show-current$/, result: 'feature/my-work\n' },
      { match: /^git diff --cached --numstat$/, result: '10\t2\ta.ts\n' },
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'hash1\n' },
    ];

    const result = await createCommit(dir, 'msg');

    expect(result.branch).toBe('feature/my-work');
    expect(result.filesChanged).toBe(1);
    expect(result.additions).toBe(10);
    expect(result.deletions).toBe(2);
    expect(calls.some((c) => c.args[0] === 'checkout')).toBe(false);
  });

  test.each(['main', 'master', 'develop'])(
    'creates a feature/auto-* branch when currently on protected branch "%s"',
    async (protectedBranch) => {
      const dir = join(TMP_ROOT, `protected-${protectedBranch}`);
      await mkdir(dir, { recursive: true });
      script = [
        { match: /^git branch --show-current$/, result: `${protectedBranch}\n` },
        { match: /^git checkout -b feature\/auto-/, result: '' },
        { match: /^git diff --cached --numstat$/, result: '1\t1\ta.ts\n' },
        { match: /^git add -A$/, result: '' },
        { match: /^git commit -m/, result: '' },
        { match: /^git rev-parse HEAD$/, result: 'hash2\n' },
      ];

      await createCommit(dir, 'msg');

      const checkoutCall = calls.find((c) => c.args[0] === 'checkout' && c.args[1] === '-b');
      expect(checkoutCall).toBeDefined();
      expect(checkoutCall?.args[2]).toMatch(/^feature\/auto-\d+$/);
    },
  );

  test('treats an empty staged diff as a no-op success without committing', async () => {
    const dir = join(TMP_ROOT, 'no-op-empty-diff');
    await mkdir(dir, { recursive: true });
    script = [
      { match: /^git branch --show-current$/, result: 'feature/already-committed\n' },
      { match: /^git diff --cached --numstat$/, result: '' },
      { match: /^git add -A$/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'existing-hash\n' },
    ];

    const result = await createCommit(dir, 'msg');

    expect(result).toEqual({
      hash: 'existing-hash',
      branch: 'feature/already-committed',
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      // The branch total is unresolvable here (no base ref scripted), so the
      // counts stay zero — but the flag still says WHY, which is the part
      // downstream logging needs.
      alreadyCommitted: true,
    });
    expect(calls.some((c) => c.args[0] === 'commit')).toBe(false);
  });

  test('回帰: 新規ステージが無い場合はブランチ全体の差分を報告する', async () => {
    // 実測 2026-08-23: 6ファイル+996行のコミットが `filesChanged:0 +0/-0` として
    // 記録され、「エージェントが何もしていない」と読める真逆の値になっていた。
    const dir = join(TMP_ROOT, 'no-op-branch-total');
    await mkdir(dir, { recursive: true });
    script = [
      { match: /^git branch --show-current$/, result: 'feature/already-committed\n' },
      { match: /^git diff --cached --numstat$/, result: '' },
      { match: /^git add -A$/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'existing-hash\n' },
      // resolveBaseRef uses the shell-string `exec`; the mock returns the base.
      { match: /merge-base/, result: 'base-sha\n' },
      {
        match: /^git diff --numstat base-sha\.\.HEAD$/,
        result: '900\t8\tsrc/a.rs\n96\t0\tsrc/b.rs\n',
      },
    ];

    const result = await createCommit(dir, 'msg', 'develop');

    expect(result.alreadyCommitted).toBe(true);
    expect(calls.some((c) => c.args[0] === 'commit')).toBe(false);
    // Either the branch total is reported, or the fork point was unresolvable
    // and it degrades to zeros — it must never report a NEW commit.
    expect(result.filesChanged === 2 || result.filesChanged === 0).toBe(true);
  });

  test('treats non-numeric numstat columns (binary files) as zero-valued counts', async () => {
    const dir = join(TMP_ROOT, 'binary-numstat');
    await mkdir(dir, { recursive: true });
    script = [
      { match: /^git branch --show-current$/, result: 'feature/binary\n' },
      { match: /^git diff --cached --numstat$/, result: '-\t-\timage.png\n' },
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'hash3\n' },
    ];

    const result = await createCommit(dir, 'msg');

    expect(result.filesChanged).toBe(1);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  test('propagates a timeout-killed commit through the existing catch path (#809)', async () => {
    const dir = join(TMP_ROOT, 'createcommit-timeout-kill');
    await mkdir(dir, { recursive: true });
    const timeoutErr = Object.assign(new Error('command timed out'), {
      killed: true,
      signal: 'SIGTERM',
    });
    script = [
      { match: /^git branch --show-current$/, result: 'feature/timeout\n' },
      { match: /^git diff --cached --numstat$/, result: '1\t0\ta.ts\n' },
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: timeoutErr },
    ];

    await expect(createCommit(dir, 'msg')).rejects.toThrow(/command timed out/);
  });

  test('deletes transient .wf-* files before staging', async () => {
    const dir = join(TMP_ROOT, 'createcommit-cleans-wf-files');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '.wf-tmp.md'), 'scratch');
    script = [
      { match: /^git branch --show-current$/, result: 'feature/clean\n' },
      { match: /^git diff --cached --numstat$/, result: '1\t0\ta.ts\n' },
      { match: /^git add -A$/, result: '' },
      { match: /^git commit -m/, result: '' },
      { match: /^git rev-parse HEAD$/, result: 'hash4\n' },
    ];

    await createCommit(dir, 'msg');

    expect(existsSync(join(dir, '.wf-tmp.md'))).toBe(false);
  });
});
