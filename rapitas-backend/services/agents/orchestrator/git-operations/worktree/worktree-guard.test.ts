/**
 * worktree-guard.test
 *
 * Agent git mutations (commit / branch switch) must REFUSE the primary working
 * tree so they never clobber the developer's checkout (main-checkout clobber
 * incident).
 */
import { describe, test, expect } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isPrimaryWorkTree,
  ensureNotPrimaryWorkTree,
  isBackendPrimaryCheckout,
  findConflictingWorktreeForBranch,
  recoverFromUnresolvedMerge,
} from './worktree-guard';

const primary = async () => true;
const worktree = async () => false;

/** Returns the primary worktree path via `git worktree list`, or null on failure. */
function getPrimaryWorktreePath(): string | null {
  try {
    const out = execSync('git worktree list --porcelain', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    // The first "worktree " line in the output is always the primary checkout.
    const line = out.split('\n').find((l: string) => l.startsWith('worktree '));
    return line ? line.slice('worktree '.length).trim() : null;
  } catch {
    return null;
  }
}

describe('isPrimaryWorkTree', () => {
  test('true for a non-git / non-existent path (fail-safe: errs toward blocking)', async () => {
    // NOTE: When detection fails, isPrimaryWorkTree returns true so the guard
    // always blocks rather than accidentally permitting a mutation on an unknown tree.
    await expect(isPrimaryWorkTree('/definitely/not/a/git/dir/zzz')).resolves.toBe(true);
  });

  test('false for a linked worktree (git-dir !== git-common-dir)', async () => {
    // NOTE: This assertion only runs when the test suite itself is executing from
    // inside a linked worktree (.worktrees/*) — the environment that makes the
    // assertion meaningful. When run from the primary checkout the test is a no-op.
    const cwd = process.cwd().replace(/\\/g, '/');
    if (!cwd.includes('/.worktrees/')) return;
    await expect(isPrimaryWorkTree(process.cwd())).resolves.toBe(false);
  });
});

describe('ensureNotPrimaryWorkTree', () => {
  test('throws on the primary working tree', async () => {
    await expect(ensureNotPrimaryWorkTree('/repo', 'commit', primary)).rejects.toThrow(
      /PRIMARY git working tree/,
    );
  });

  test('resolves for a linked worktree', async () => {
    await expect(
      ensureNotPrimaryWorkTree('/repo/.worktrees/task-1', 'commit', worktree),
    ).resolves.toBeUndefined();
  });

  test('includes the operation label in the error', async () => {
    await expect(
      ensureNotPrimaryWorkTree('/repo', 'switch to branch feature/x', primary),
    ).rejects.toThrow(/switch to branch feature\/x/);
  });
});

describe('ensureNotPrimaryWorkTree — default detection path (no injected isPrimary)', () => {
  test('a missing path is reported as undetermined / path missing — NOT as primary (still refused)', async () => {
    // NOTE: This is the task-560 phantom-worktree scenario: the directory vanished,
    // yet the old wording blamed the PRIMARY checkout and hid the real failure.
    const missing = join(tmpdir(), 'wt-guard-definitely-missing-zzz-601');
    let caught: unknown;
    try {
      await ensureNotPrimaryWorkTree(missing, 'switch to branch bugfix/t601');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // Fail safe is intact (the call threw) AND the message states the true cause.
    expect(message).toMatch(/could not determine/i);
    expect(message).toMatch(/does not exist/i);
    expect(message).not.toMatch(/in the PRIMARY git working tree/);
    expect(message).toMatch(/switch to branch bugfix\/t601/);
  });

  test('a real but non-git directory carries the original git failure in the error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-guard-test-'));
    try {
      let caught: unknown;
      try {
        await ensureNotPrimaryWorkTree(dir, 'commit');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const err = caught as Error;
      expect(err.message).toMatch(/could not determine/i);
      // The original exception must be preserved — both embedded in the message
      // text ("Cause: ...") and as the structured `cause`.
      const causeText = err.cause instanceof Error ? err.cause.message : String(err.cause);
      expect(`${err.message}\n${causeText}`).toMatch(/not a git repository/i);
      expect(err.cause).toBeDefined();
    } finally {
      // NOTE: Best-effort cleanup with retries — when Promise.all inside the
      // guard rejects on the first git rev-parse, the second git child can
      // still be running with cwd inside `dir`, which makes an immediate
      // rmSync fail with EBUSY on Windows. Never fail the test on cleanup.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }
  });

  test('the actual primary checkout still gets the traditional PRIMARY wording (regression)', async () => {
    const primaryPath = getPrimaryWorktreePath();
    if (!primaryPath) return; // skip when git is unavailable
    await expect(ensureNotPrimaryWorkTree(primaryPath, 'commit')).rejects.toThrow(
      /Refusing to commit in the PRIMARY git working tree/,
    );
  });
});

describe('isBackendPrimaryCheckout', () => {
  test('false for a non-existent / non-git directory (fail open, never refuses spuriously)', async () => {
    await expect(
      isBackendPrimaryCheckout('/definitely/not/a/git/repo/zzz-nonexistent'),
    ).resolves.toBe(false);
  });

  test("true for the backend's own primary checkout", async () => {
    // NOTE: Cannot use process.cwd() directly — when bun test runs inside a linked
    // worktree (.worktrees/*), process.cwd() is NOT the primary checkout. Instead,
    // locate the primary checkout dynamically via `git worktree list --porcelain`
    // so the test is correct in both primary-checkout and worktree environments.
    const primaryPath = getPrimaryWorktreePath();
    if (!primaryPath) return; // skip when git is unavailable
    await expect(isBackendPrimaryCheckout(primaryPath)).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findConflictingWorktreeForBranch
// ---------------------------------------------------------------------------
// Uses an injectable exec function (script-based) so these tests run without
// real git, and without mock.module (which would disrupt the real-git tests above).

type ScriptEntry = { match: RegExp; result: string | Error };

function makeScriptedExec(
  entries: ScriptEntry[],
): (cmd: string, opts: { cwd: string }) => Promise<{ stdout: string }> {
  return async (cmd: string) => {
    for (const e of entries) {
      if (e.match.test(cmd)) {
        if (e.result instanceof Error) throw e.result;
        return { stdout: e.result };
      }
    }
    return { stdout: '' };
  };
}

describe('findConflictingWorktreeForBranch', () => {
  test('別worktreeが対象ブランチを使用中の場合そのパスを返すこと', async () => {
    const exec = makeScriptedExec([
      {
        match: /git worktree list --porcelain/,
        result: [
          'worktree /other-wt\nHEAD abc1234abc1234abc1234abc1234abc1234abc1234\nbranch refs/heads/feature/x',
          'worktree /my-dir\nHEAD def5678def5678def5678def5678def5678def5678\nbranch refs/heads/main',
          '',
        ].join('\n\n'),
      },
    ]);

    const result = await findConflictingWorktreeForBranch('/my-dir', 'feature/x', exec);
    expect(result).toBe('/other-wt');
  });

  test('自分自身が同ブランチ上にある場合はnullを返すこと（チェックアウト続行）', async () => {
    const exec = makeScriptedExec([
      {
        match: /git worktree list --porcelain/,
        result: [
          'worktree /my-dir\nHEAD abc1234abc1234abc1234abc1234abc1234abc1234\nbranch refs/heads/feature/x',
          '',
        ].join('\n\n'),
      },
    ]);

    const result = await findConflictingWorktreeForBranch('/my-dir', 'feature/x', exec);
    expect(result).toBeNull();
  });

  test('どのworktreeも対象ブランチを使用していない場合はnullを返すこと', async () => {
    const exec = makeScriptedExec([
      {
        match: /git worktree list --porcelain/,
        result: [
          'worktree /my-dir\nHEAD abc1234abc1234abc1234abc1234abc1234abc1234\nbranch refs/heads/main',
          '',
        ].join('\n\n'),
      },
    ]);

    const result = await findConflictingWorktreeForBranch('/my-dir', 'feature/x', exec);
    expect(result).toBeNull();
  });

  test('git worktree list が失敗した場合はnullを返すこと（fail-safe）', async () => {
    const exec = makeScriptedExec([
      {
        match: /git worktree list --porcelain/,
        result: new Error('cannot list worktrees'),
      },
    ]);

    const result = await findConflictingWorktreeForBranch('/my-dir', 'feature/x', exec);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recoverFromUnresolvedMerge
// ---------------------------------------------------------------------------
// Uses real temp git repos (same style as the isPrimaryWorkTree tests above) so
// the reproduction test exercises the actual git error text from task 691.

/** Best-effort recursive delete with retries — mirrors the cleanup above. */
function cleanupDir(dir: string): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      // retry below
    }
  }
}

/** Create a temp repo left with an unresolved merge conflict (MERGE_HEAD set). */
function initRepoWithUnresolvedMerge(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wt-guard-merge-'));
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
  run('git init -q -b main');
  run('git config user.email test@example.com');
  run('git config user.name Test');
  writeFileSync(join(dir, 'f.txt'), 'base\n');
  run('git add -A');
  run('git commit -q -m base');
  run('git checkout -q -b feature');
  writeFileSync(join(dir, 'f.txt'), 'feature-change\n');
  run('git commit -q -am feature-change');
  run('git checkout -q main');
  writeFileSync(join(dir, 'f.txt'), 'main-change\n');
  run('git commit -q -am main-change');
  run('git checkout -q feature');
  try {
    run('git merge main --no-edit');
  } catch {
    // Expected: conflicting merge stops with MERGE_HEAD set and an unresolved index.
  }
  return dir;
}

describe('recoverFromUnresolvedMerge', () => {
  test('バグ再現: 未解決マージが残る worktree では checkout が "resolve your current index first" で失敗すること', () => {
    const dir = initRepoWithUnresolvedMerge();
    try {
      expect(() => execSync('git checkout -q main', { cwd: dir, stdio: 'pipe' })).toThrow(
        /resolve your current index first/,
      );
    } finally {
      cleanupDir(dir);
    }
  });

  test('未解決マージを検知しabortして後続のcheckoutを回復させること', async () => {
    const dir = initRepoWithUnresolvedMerge();
    try {
      await expect(recoverFromUnresolvedMerge(dir)).resolves.toBe(true);
      // MERGE_HEAD is gone.
      expect(() =>
        execSync('git rev-parse --verify -q MERGE_HEAD', { cwd: dir, stdio: 'pipe' }),
      ).toThrow();
      // The operation that failed before recovery now succeeds.
      expect(() => execSync('git checkout -q main', { cwd: dir, stdio: 'pipe' })).not.toThrow();
    } finally {
      cleanupDir(dir);
    }
  });

  test('未解決マージが無ければ何もせずfalseを返すこと', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-guard-clean-'));
    const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
    try {
      run('git init -q -b main');
      run('git config user.email test@example.com');
      run('git config user.name Test');
      writeFileSync(join(dir, 'f.txt'), 'base\n');
      run('git add -A');
      run('git commit -q -m base');
      await expect(recoverFromUnresolvedMerge(dir)).resolves.toBe(false);
    } finally {
      cleanupDir(dir);
    }
  });
});
