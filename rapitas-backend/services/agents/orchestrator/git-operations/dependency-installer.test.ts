/**
 * Tests for installWorktreeDependencies.
 *
 * Verifies that the linker delegates to scripts/setup-worktree.cjs (NEVER an
 * installer), skips when the script is absent, and surfaces failures.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const mockExec = mock(
  (
    _command: string,
    options: unknown,
    callback?: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const cb = (typeof options === 'function' ? options : callback) as
      | ((error: Error | null, stdout: string, stderr: string) => void)
      | undefined;
    cb?.(null, '', '');
    return { kill: mock(() => undefined) };
  },
);

// NOTE: Mirror ALL child_process exports — bun mock.module is process-global, and
// sibling modules loaded in the same test process (e.g. core-ops.ts, worktree-ops.ts,
// branch-pr-ops.ts) import execFile, not exec. Without this stub their import would
// fail to resolve when this mock is the last one registered for the module.
const mockExecFile = mock(() => ({ kill: mock(() => undefined) }));
mock.module('node:child_process', () => ({ exec: mockExec, execFile: mockExecFile }));
mock.module('child_process', () => ({ exec: mockExec, execFile: mockExecFile }));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const {
  installWorktreeDependencies,
  startWorktreeDependenciesInstall,
  awaitWorktreeDependencies,
  clearWorktreeDependenciesTracking,
  taskNeedsDependencies,
} = await import('./dependency-installer');

const TMP_ROOT = resolve('.tmp-tests/dependency-installer');

/** Create a worktree that carries the (tracked) setup-worktree.cjs script. */
async function makeWorktreeWithSetup(dir: string): Promise<void> {
  await mkdir(join(dir, 'scripts'), { recursive: true });
  await writeFile(join(dir, 'scripts', 'setup-worktree.cjs'), '// stub setup-worktree');
}

function resetMockOk(): void {
  mockExec.mockReset();
  mockExec.mockImplementation(
    (
      _command: string,
      options: unknown,
      callback?: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const cb = (typeof options === 'function' ? options : callback) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      cb?.(null, '', '');
      return { kill: mock(() => undefined) };
    },
  );
}

describe('installWorktreeDependencies', () => {
  beforeEach(async () => {
    resetMockOk();
    await rm(TMP_ROOT, { recursive: true, force: true });
    await mkdir(TMP_ROOT, { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP_ROOT, { recursive: true, force: true });
  });

  test('links via setup-worktree.cjs at the worktree root (never an installer)', async () => {
    const worktree = join(TMP_ROOT, 'wt1');
    await makeWorktreeWithSetup(worktree);

    await installWorktreeDependencies(worktree);

    expect(mockExec).toHaveBeenCalledTimes(1);
    const command = mockExec.mock.calls[0]?.[0] as string;
    expect(command).toContain('setup-worktree.cjs');
    expect(command).toContain('node');
    expect(command).not.toContain('pnpm install');
    expect(command).not.toContain('npm install');
    expect(command).not.toContain('bun install');

    const opts = mockExec.mock.calls[0]?.[1] as { cwd?: string } | undefined;
    expect(opts?.cwd).toBe(worktree);
  });

  test('skips (no exec) when setup-worktree.cjs is absent', async () => {
    const worktree = join(TMP_ROOT, 'wt-noscript');
    await mkdir(worktree, { recursive: true });

    await installWorktreeDependencies(worktree);

    expect(mockExec).not.toHaveBeenCalled();
  });

  test('throws when setup-worktree.cjs fails', async () => {
    const worktree = join(TMP_ROOT, 'wt-fail');
    await makeWorktreeWithSetup(worktree);

    mockExec.mockImplementation(
      (
        _command: string,
        options: unknown,
        callback?: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const cb = (typeof options === 'function' ? options : callback) as
          | ((error: Error | null, stdout: string, stderr: string) => void)
          | undefined;
        cb?.(new Error('link failed'), '', '');
        return { kill: mock(() => undefined) };
      },
    );

    await expect(installWorktreeDependencies(worktree)).rejects.toThrow(
      /setup-worktree\.cjs failed/,
    );
  });
});

describe('startWorktreeDependenciesInstall / awaitWorktreeDependencies', () => {
  beforeEach(async () => {
    resetMockOk();
    await rm(TMP_ROOT, { recursive: true, force: true });
    await mkdir(TMP_ROOT, { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP_ROOT, { recursive: true, force: true });
  });

  test('multiple callers share a single in-flight setup', async () => {
    const worktree = join(TMP_ROOT, 'wt-shared');
    await makeWorktreeWithSetup(worktree);

    const p1 = startWorktreeDependenciesInstall(worktree);
    const p2 = startWorktreeDependenciesInstall(worktree);
    const p3 = awaitWorktreeDependencies(worktree);

    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    await Promise.all([p1, p2, p3]);
    // Only one setup was triggered for the shared worktree.
    expect(mockExec).toHaveBeenCalledTimes(1);

    clearWorktreeDependenciesTracking(worktree);
  });

  test('clear() lets a subsequent setup run again', async () => {
    const worktree = join(TMP_ROOT, 'wt-clear');
    await makeWorktreeWithSetup(worktree);

    await startWorktreeDependenciesInstall(worktree);
    expect(mockExec).toHaveBeenCalledTimes(1);

    clearWorktreeDependenciesTracking(worktree);
    await startWorktreeDependenciesInstall(worktree);
    expect(mockExec).toHaveBeenCalledTimes(2);

    clearWorktreeDependenciesTracking(worktree);
  });
});

describe('taskNeedsDependencies', () => {
  test('returns false for docs-only tasks', () => {
    expect(taskNeedsDependencies('Update docs', 'Fix typos in README')).toBe(false);
    expect(taskNeedsDependencies('READMEを更新', null)).toBe(false);
    expect(taskNeedsDependencies('コメント追加', null)).toBe(false);
    expect(taskNeedsDependencies('誤字修正', null)).toBe(false);
  });

  test('returns true for code-change tasks', () => {
    expect(taskNeedsDependencies('Add login feature', null)).toBe(true);
    expect(taskNeedsDependencies('Fix login bug', null)).toBe(true);
    expect(taskNeedsDependencies('実装', '新機能を追加')).toBe(true);
    expect(taskNeedsDependencies('Refactor task service', null)).toBe(true);
  });

  test('returns true when ambiguous (default safe)', () => {
    expect(taskNeedsDependencies('Investigate something', null)).toBe(true);
    expect(taskNeedsDependencies('xyz', null)).toBe(true);
  });

  test('code indicators win over docs hints', () => {
    expect(taskNeedsDependencies('Update README and add unit tests', null)).toBe(true);
  });
});
