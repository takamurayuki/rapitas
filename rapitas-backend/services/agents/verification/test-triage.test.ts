import { describe, test, expect, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  classifyFailures,
  defaultSetupWorktree,
  SETUP_SCRIPT_TIMEOUT_MS,
  takeSetupFailure,
  triageTestFailures,
} from './test-triage';

describe('classifyFailures', () => {
  test('splits currently-failing files into pre-existing and new', () => {
    const result = classifyFailures(
      ['a.test.ts', 'b.test.ts', 'c.test.ts'],
      new Set(['a.test.ts']),
    );
    expect(result.preExisting).toEqual(['a.test.ts']);
    expect(result.newFailures).toEqual(['b.test.ts', 'c.test.ts']);
  });

  test('returns empty arrays when nothing is currently failing', () => {
    expect(classifyFailures([], new Set(['a.test.ts']))).toEqual({
      preExisting: [],
      newFailures: [],
    });
  });

  test('classifies everything as new when the baseline set is empty', () => {
    expect(classifyFailures(['a.test.ts'], new Set())).toEqual({
      preExisting: [],
      newFailures: ['a.test.ts'],
    });
  });

  test('classifies everything as pre-existing when all are in the baseline', () => {
    expect(
      classifyFailures(['a.test.ts', 'b.test.ts'], new Set(['a.test.ts', 'b.test.ts'])),
    ).toEqual({ preExisting: ['a.test.ts', 'b.test.ts'], newFailures: [] });
  });
});

describe('triageTestFailures', () => {
  test('returns empty classification immediately when scopedTestFiles is empty', async () => {
    const result = await triageTestFailures('/root', '/workdir', []);
    expect(result).toEqual({ preExisting: [], newFailures: [] });
  });

  test('returns empty classification when nothing is currently failing', async () => {
    const isTestFileFailingFn = mock(() => Promise.resolve(false));
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn,
    });
    expect(result).toEqual({ preExisting: [], newFailures: [] });
    expect(isTestFileFailingFn).toHaveBeenCalledTimes(1);
  });

  test('returns null when the merge-base commit cannot be resolved', async () => {
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve(null),
    });
    expect(result).toBeNull();
  });

  test('returns null when the main repo root cannot be resolved', async () => {
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve(null),
    });
    expect(result).toBeNull();
  });

  test('returns null when creating the baseline worktree fails, and does not attempt removal', async () => {
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(false),
      removeWorktreeFn,
      retryDelayMs: 0,
    });
    expect(result).toBeNull();
    expect(removeWorktreeFn).not.toHaveBeenCalled();
  });

  test('returns null when baseline setup fails, but still removes the worktree', async () => {
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn: () => Promise.resolve(false),
      removeWorktreeFn,
      retryDelayMs: 0,
    });
    expect(result).toBeNull();
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });

  test('classifies a file as new when it does not exist in the baseline (existsSync false)', async () => {
    const removeWorktreeFn = mock(() => Promise.resolve());
    // isTestFileFailingFn is only used for the CURRENT-worktree check here
    // (existsSync gates the baseline check before isFailing would be called
    // against the baseline path) — return true so it's in currentFailing.
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn,
    });
    // The baseline file path (under a randomly-named .worktrees/triage-* dir)
    // will never exist on the real filesystem in this test, so it's treated
    // as newly-added by the agent -> a new failure, not pre-existing.
    expect(result).toEqual({ preExisting: [], newFailures: ['a.test.ts'] });
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });

  test('propagates an unexpected error as null (fail-safe) and still cleans up', async () => {
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.reject(new Error('boom')),
      removeWorktreeFn,
    });
    expect(result).toBeNull();
  });

  test('a rejecting removeWorktreeFn does not throw out of triageTestFailures', async () => {
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn: () => Promise.reject(new Error('cleanup failed')),
    });
    expect(result).toEqual({ preExisting: [], newFailures: ['a.test.ts'] });
  });
});

// Task 659: a transient worktree-create / setup failure must be retried once
// before the triage gives up (null = indeterminate), and the retry must not
// leak a second baseline worktree or remove the wrong directory.
describe('triageTestFailures — baseline infra retries (task 659)', () => {
  const infra = {
    isTestFileFailingFn: () => Promise.resolve(true),
    resolveBaseCommitFn: () => Promise.resolve('abcdef'),
    getMainRepoRootFn: () => Promise.resolve('/main-repo'),
    retryDelayMs: 0,
  };

  test('worktree creation failing once then succeeding classifies normally, under a fresh dir', async () => {
    const createWorktreeFn = mock((_root: string, _dir: string, _commit: string) =>
      Promise.resolve(createWorktreeFn.mock.calls.length >= 2),
    );
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      ...infra,
      createWorktreeFn,
      setupWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn,
    });
    expect(result).toEqual({ preExisting: [], newFailures: ['a.test.ts'] });
    expect(createWorktreeFn).toHaveBeenCalledTimes(2);
    const [firstDir, secondDir] = createWorktreeFn.mock.calls.map((c) => c[1]);
    expect(secondDir).not.toBe(firstDir);
    // Cleanup targets the directory that was actually created (the 2nd), once.
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
    expect(removeWorktreeFn.mock.calls[0]?.[1]).toBe(secondDir);
  });

  test('worktree creation failing twice returns null (indeterminate) without cleanup', async () => {
    const createWorktreeFn = mock(() => Promise.resolve(false));
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      ...infra,
      createWorktreeFn,
      setupWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn,
    });
    expect(result).toBeNull();
    expect(createWorktreeFn).toHaveBeenCalledTimes(2);
    expect(removeWorktreeFn).not.toHaveBeenCalled();
  });

  test('setup failing once then succeeding classifies normally on the same dir', async () => {
    const createWorktreeFn = mock(() => Promise.resolve(true));
    const setupWorktreeFn = mock((_dir: string) =>
      Promise.resolve(setupWorktreeFn.mock.calls.length >= 2),
    );
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      ...infra,
      createWorktreeFn,
      setupWorktreeFn,
      removeWorktreeFn,
    });
    expect(result).toEqual({ preExisting: [], newFailures: ['a.test.ts'] });
    expect(createWorktreeFn).toHaveBeenCalledTimes(1);
    expect(setupWorktreeFn).toHaveBeenCalledTimes(2);
    expect(setupWorktreeFn.mock.calls[0]?.[0]).toBe(setupWorktreeFn.mock.calls[1]?.[0]);
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });

  test('setup failing twice returns null (indeterminate) and removes the worktree once', async () => {
    const setupWorktreeFn = mock(() => Promise.resolve(false));
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      ...infra,
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn,
      removeWorktreeFn,
    });
    expect(result).toBeNull();
    expect(setupWorktreeFn).toHaveBeenCalledTimes(2);
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });
});

// Task 1161: generated projects have no scripts/setup-worktree.cjs, so the old
// setup always failed twice and left the test gate indeterminate (open). The
// default setup now delegates to the project bootstrap instead.
/**
 * Remove a temp dir, retrying briefly on EBUSY.
 *
 * NOTE(#1339): a child killed by the setup-script timeout can still hold its
 * cwd for a few milliseconds on Windows, and `force: true` does not cover
 * EBUSY. Without the retry the timeout test fails in cleanup, after the
 * behaviour it asserts has already passed.
 */
async function rmDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  // Last attempt: a leaked temp dir is not worth failing a green test over.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* give up; the OS tmp dir is swept eventually */
  }
}

// NOTE(#1339): these tests used to spawn a REAL node process through a shell —
// two process creations on Windows — and that cost, not the code under test,
// was what failed. Measured: bun's default 5000ms budget exceeded at
// 5015-5032ms; node spawn alone 146-538ms (median 417) on an idle host; and
// raising the per-test budget to 30s still gave only **3/5 green** under two
// concurrent typechecks, where the suite took 122s per run. Process creation
// is pathologically slow under contention here, so no budget is both reliable
// and still a backstop.
//
// So the logic is asserted through an injected command runner, and exactly one
// test below spawns for real to pin the command line.
const SPAWN_TEST_BUDGET_MS = 60_000;

/** Stand-in for runTriageCmd: records the call and answers with `code`. */
function fakeRunCmd(code: number, stderr = '') {
  const calls: Array<{ command: string; cwd: string; timeoutMs?: number }> = [];
  const fn = (command: string, cwd: string, timeoutMs?: number) => {
    calls.push({ command, cwd, timeoutMs });
    return Promise.resolve({ code, stdout: '', stderr });
  };
  return { fn: fn as unknown as Parameters<typeof defaultSetupWorktree>[3], calls };
}

describe('defaultSetupWorktree — projects without setup-worktree.cjs (task 1161)', () => {
  const withTmpDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), 'triage-setup-'));
    try {
      await fn(dir);
    } finally {
      await rmDirWithRetry(dir);
    }
  };

  test('delegates to the bootstrap and succeeds when it linked dependencies', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = mock((_p: string) =>
        Promise.resolve({ action: 'linked' as const, detail: '1 link(s): .' }),
      );
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(true);
      expect(bootstrapFn).toHaveBeenCalledWith(dir);
    });
  });

  test('succeeds when the bootstrap installed dependencies', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () =>
        Promise.resolve({ action: 'installed' as const, detail: '1 link(s): .' });
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(true);
    });
  });

  test('succeeds when the bootstrap skipped because node_modules is already usable', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () =>
        Promise.resolve({
          action: 'skipped' as const,
          detail: 'worktree already has usable node_modules',
        });
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(true);
    });
  });

  test("returns 'no-manifest' when the baseline has no project manifest", async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () =>
        Promise.resolve({ action: 'skipped' as const, detail: 'no manifest' });
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe('no-manifest');
    });
  });

  test('returns false without leaking when the bootstrap throws', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () => Promise.reject(new Error('install failed'));
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(false);
    });
  });

  test('runs a present setup script and skips the bootstrap', async () => {
    await withTmpDir(async (dir) => {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'setup-worktree.cjs'), 'process.exit(0);\n');
      const bootstrapFn = mock(() => Promise.resolve({ action: 'linked' as const, detail: '' }));
      const runner = fakeRunCmd(0);

      expect(await defaultSetupWorktree(dir, bootstrapFn, undefined, runner.fn)).toBe(true);

      expect(bootstrapFn).not.toHaveBeenCalled();
      // Asserted through the seam: the script really is what gets invoked, in
      // the baseline dir, with the production budget.
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0]!.command).toContain('setup-worktree.cjs');
      expect(runner.calls[0]!.cwd).toBe(dir);
      expect(runner.calls[0]!.timeoutMs).toBe(SETUP_SCRIPT_TIMEOUT_MS);
    });
  });

  test('a present-but-failing setup script does not fall back to the bootstrap', async () => {
    await withTmpDir(async (dir) => {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'setup-worktree.cjs'), 'process.exit(1);\n');
      const bootstrapFn = mock(() => Promise.resolve({ action: 'linked' as const, detail: '' }));

      expect(await defaultSetupWorktree(dir, bootstrapFn, undefined, fakeRunCmd(1).fn)).toBe(false);

      expect(bootstrapFn).not.toHaveBeenCalled();
    });
  });

  // The one test that still spawns, so the command line is pinned against a
  // real node rather than only against the fake. Generous budget on purpose —
  // see the note above; it is a backstop, not a performance assertion.
  test(
    'really executes the script through the production runner',
    async () => {
      await withTmpDir(async (dir) => {
        mkdirSync(join(dir, 'scripts'));
        // Exits 0 only if it is actually run by node in the baseline dir.
        writeFileSync(
          join(dir, 'scripts', 'setup-worktree.cjs'),
          "process.exit(process.cwd() === require('fs').realpathSync(process.cwd()) ? 0 : 1);\n",
        );
        const bootstrapFn = mock(() => Promise.resolve({ action: 'linked' as const, detail: '' }));

        expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(true);
        expect(bootstrapFn).not.toHaveBeenCalled();
      });
    },
    SPAWN_TEST_BUDGET_MS,
  );
});

describe("triageTestFailures — 'no-manifest' baseline (task 1161)", () => {
  test("returns null without retrying when setup reports 'no-manifest'", async () => {
    const setupWorktreeFn = mock((_dir: string) => Promise.resolve('no-manifest' as const));
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn,
      removeWorktreeFn,
      retryDelayMs: 0,
    });
    expect(result).toBeNull();
    expect(setupWorktreeFn).toHaveBeenCalledTimes(1);
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });
});

// Task 1172: the final "baseline setup failed after retries" WARN carried no
// cause, so every indeterminate triage needed a manual log dig.
describe('baseline setup failure reasons (task 1172)', () => {
  const withTmpDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), 'triage-reason-'));
    try {
      await fn(dir);
    } finally {
      await rmDirWithRetry(dir);
    }
  };

  test('records a bootstrap-error with the message when the bootstrap throws', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () => Promise.reject(new Error('pnpm install exited 1'));
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(false);
      const failure = takeSetupFailure(dir);
      expect(failure?.kind).toBe('bootstrap-error');
      expect(failure?.reason).toContain('pnpm install exited 1');
      // consumed: a second take must not return a stale entry
      expect(takeSetupFailure(dir)).toBeUndefined();
    });
  });

  test('records script-exit with a truncated stderr tail when the setup script fails', async () => {
    await withTmpDir(async (dir) => {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(
        join(dir, 'scripts', 'setup-worktree.cjs'),
        "console.error('x'.repeat(2000) + 'TAIL_MARKER'); process.exit(3);",
      );
      // Through the seam: the truncation is string handling, and spawning a
      // real process to produce the string is what made this unreliable.
      const runner = fakeRunCmd(3, 'x'.repeat(2000) + 'TAIL_MARKER');

      expect(await defaultSetupWorktree(dir, undefined, undefined, runner.fn)).toBe(false);

      const failure = takeSetupFailure(dir);
      expect(failure?.kind).toBe('script-exit');
      expect(failure?.reason).toContain('TAIL_MARKER');
      expect(failure?.reason.length).toBeLessThanOrEqual(500);
    });
  });

  // #1339: the budget was the inline literal 120_000 while bun's per-test
  // budget is 5000ms, so this branch could not be tested at all — a timeout
  // handler with no test. Exit 124 is runTriageCmd's timeout signal.
  test('records script-timeout when the runner reports a timeout', async () => {
    await withTmpDir(async (dir) => {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'setup-worktree.cjs'), 'setInterval(() => {}, 1000);');

      expect(await defaultSetupWorktree(dir, undefined, undefined, fakeRunCmd(124).fn)).toBe(false);

      expect(takeSetupFailure(dir)?.kind).toBe('script-timeout');
    });
  });

  test('a script that finishes inside its budget is not a timeout', async () => {
    // Guards the obvious over-correction: exit 0 must not be read as a timeout.
    await withTmpDir(async (dir) => {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'setup-worktree.cjs'), 'process.exit(0);');

      expect(await defaultSetupWorktree(dir, undefined, undefined, fakeRunCmd(0).fn)).toBe(true);
      expect(takeSetupFailure(dir)).toBeUndefined();
    });
  });

  // The timeout is still wired end-to-end with a real process, once: a fake
  // returning 124 proves the mapping, not that the budget is actually applied.
  test(
    'really times out a script that never exits',
    async () => {
      await withTmpDir(async (dir) => {
        mkdirSync(join(dir, 'scripts'));
        // Outlives the 300ms budget so the timeout fires, but gives itself a
        // hard stop. A script that truly never exits leaves a dangling child
        // when SIGKILL does not take on Windows, and the whole `test:ci` run
        // then completes its tests and hangs instead of exiting — measured:
        // 2273 pass printed, process still alive at 600s.
        writeFileSync(
          join(dir, 'scripts', 'setup-worktree.cjs'),
          'setInterval(() => {}, 100); setTimeout(() => process.exit(0), 3000);',
        );

        expect(await defaultSetupWorktree(dir, undefined, 300)).toBe(false);

        expect(takeSetupFailure(dir)?.kind).toBe('script-timeout');
      });
    },
    SPAWN_TEST_BUDGET_MS,
  );

  test('records nothing when setup succeeds', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () => Promise.resolve({ action: 'linked' as const, detail: '' });
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(true);
      expect(takeSetupFailure(dir)).toBeUndefined();
    });
  });

  test('a recorded failure is consumed by the final indeterminate WARN path', async () => {
    const dirs: string[] = [];
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abc123'),
      getMainRepoRootFn: () => Promise.resolve('/root'),
      createWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn: () => Promise.resolve(),
      retryDelayMs: 0,
      setupWorktreeFn: async (dir) => {
        dirs.push(dir);
        await defaultSetupWorktree(dir, () => Promise.reject(new Error('boom')));
        return false;
      },
    });
    expect(result).toBeNull();
    expect(dirs).toHaveLength(2);
    // triage must not leak the entry after reporting it
    expect(takeSetupFailure(dirs[0]!)).toBeUndefined();
  });
});
