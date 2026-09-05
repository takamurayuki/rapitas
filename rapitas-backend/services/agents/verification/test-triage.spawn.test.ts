/**
 * test-triage.spawn.test
 *
 * Exercises the real (non-injected) default implementations in test-triage.ts
 * — runTriageCmd, resolveBaseCommit, getMainRepoRoot, isTestFileFailing,
 * defaultCreateWorktree, defaultSetupWorktree — by mocking `child_process.spawn`
 * only. No real git/subprocess/worktree operations ever run; `fs.existsSync`
 * is left real (read-only) since it's only ever used to check whether a path
 * exists, never to mutate anything.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';

interface SpawnRule {
  match: (command: string) => boolean;
  code?: number;
  stdout?: string;
  errorOnly?: boolean;
}

let rules: SpawnRule[] = [];
const calls: string[] = [];

function resolveRule(command: string): SpawnRule {
  return rules.find((r) => r.match(command)) ?? { code: 0, stdout: '' };
}

const spawnMock = mock((command: string) => {
  calls.push(command);
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: string) => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  queueMicrotask(() => {
    const rule = resolveRule(command);
    if (rule.stdout) child.stdout.emit('data', Buffer.from(rule.stdout));
    if (rule.errorOnly) {
      child.emit('error', new Error('spawn failed'));
    } else {
      child.emit('close', rule.code ?? 0);
    }
  });
  return child;
});

// Both specifiers ('child_process' / 'node:child_process') and both `exec`/
// `execFile` are mirrored because test-triage.ts's static import of
// removeWorktree (from worktree-ops.ts) transitively pulls in repository-setup.ts
// and git-exec.ts (`exec`) plus worktree-ops.ts itself (`execFile`) at module
// load time, even though these tests always inject removeWorktreeFn and never
// call the real removeWorktree.
const unusedExecMock = mock(() => {
  throw new Error('exec should not be called in test-triage.spawn.test.ts');
});
mock.module('child_process', () => ({
  spawn: spawnMock,
  exec: unusedExecMock,
  execFile: unusedExecMock,
}));
mock.module('node:child_process', () => ({
  spawn: spawnMock,
  exec: unusedExecMock,
  execFile: unusedExecMock,
}));

const { triageTestFailures } = await import('./test-triage');

beforeEach(() => {
  rules = [];
  calls.length = 0;
  spawnMock.mockClear();
});

describe('test-triage internal defaults (spawn mocked, fs real)', () => {
  it('resolveBaseCommit falls back develop -> main -> master, and getMainRepoRoot parses the porcelain output', async () => {
    rules = [
      { match: (c) => c.includes('git merge-base HEAD develop'), code: 1 },
      { match: (c) => c.includes('git merge-base HEAD main'), code: 1 },
      { match: (c) => c.includes('git merge-base HEAD master'), code: 0, stdout: 'masterhash\n' },
      {
        match: (c) => c === 'git worktree list --porcelain',
        code: 0,
        stdout: 'worktree /fake/main-repo\nHEAD abc123\nbranch refs/heads/develop\n',
      },
    ];
    const createWorktreeFn = mock(() => Promise.resolve(false));
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      createWorktreeFn,
      retryDelayMs: 0,
    });
    expect(result).toBeNull();
    expect(createWorktreeFn).toHaveBeenCalledWith(
      '/fake/main-repo',
      expect.any(String),
      'masterhash',
    );
    expect(calls.some((c) => c.includes('git merge-base HEAD develop'))).toBe(true);
    expect(calls.some((c) => c.includes('git merge-base HEAD main'))).toBe(true);
    expect(calls.some((c) => c.includes('git merge-base HEAD master'))).toBe(true);
  });

  it('returns null via the real defaultSetupWorktree when the baseline lacks setup-worktree.cjs', async () => {
    rules = [{ match: (c) => c.includes('git worktree add --detach'), code: 0 }];
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('basehash'),
      getMainRepoRootFn: () => Promise.resolve('/definitely/not/a/real/repo'),
      removeWorktreeFn,
      retryDelayMs: 0,
    });
    expect(result).toBeNull();
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });

  it('runs the full real chain (isTestFileFailing for current + baseline) and classifies pre-existing vs. new', async () => {
    // Point projectRoot at a real, existing directory in this repo so the
    // baseline path (reached via ../.. from the fabricated .worktrees/triage-*
    // dir) resolves to a real path too — letting existsSync's baseline check
    // pass without touching the filesystem.
    const projectRoot = join(process.cwd(), 'services', 'agents', 'verification');
    const workdir = join(process.cwd(), 'a', 'b'); // 2 segments, matching '.worktrees/triage-*' depth

    rules = [
      {
        match: (c) => c.includes('git merge-base HEAD develop'),
        code: 0,
        stdout: 'basehash\n',
      },
      {
        match: (c) => c === 'git worktree list --porcelain',
        code: 0,
        stdout: `worktree ${process.cwd()}\n`,
      },
      { match: (c) => c.includes('git worktree add --detach'), code: 0 },
      {
        match: (c) => c.includes('bun test --isolate "automated-verifier.test.ts"'),
        code: 1, // fails both in the current worktree and in the baseline
      },
    ];
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures(projectRoot, workdir, ['automated-verifier.test.ts'], {
      setupWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn,
      retryDelayMs: 0,
    });
    expect(result).toEqual({ preExisting: ['automated-verifier.test.ts'], newFailures: [] });
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
    // Sanity-check the relative-path trick actually landed on a real directory.
    expect(relative(workdir, projectRoot)).toBe(
      join('..', '..', 'services', 'agents', 'verification'),
    );
  });

  it('runs vitest, not bun test, via the default isTestFileFailing for a vitest project (#859 regression)', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'triage-vitest-'));
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }),
    );
    writeFileSync(join(projectRoot, 'pnpm-lock.yaml'), '');
    try {
      rules = [{ match: (c) => c.includes('vitest run') && c.includes('foo.test.ts'), code: 1 }];
      const createWorktreeFn = mock(() => Promise.resolve(false));
      const result = await triageTestFailures(projectRoot, projectRoot, ['foo.test.ts'], {
        resolveBaseCommitFn: () => Promise.resolve('basehash'),
        getMainRepoRootFn: () => Promise.resolve('/fake/main-repo'),
        createWorktreeFn,
        retryDelayMs: 0,
      });
      // Baseline worktree creation is stubbed to fail (irrelevant to this
      // regression) — the point is the spawn command chosen in step 1.
      expect(result).toBeNull();
      expect(
        calls.some((c) => c.includes('pnpm exec vitest run') && c.includes('foo.test.ts')),
      ).toBe(true);
      expect(calls.some((c) => c.includes('bun test'))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
