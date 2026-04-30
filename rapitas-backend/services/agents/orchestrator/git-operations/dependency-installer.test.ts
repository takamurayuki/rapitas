/**
 * Tests for installWorktreeDependencies.
 *
 * Verifies that the installer correctly enumerates package.json + pnpm-lock.yaml
 * pairs and runs pnpm install in each, and that failures are surfaced.
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

mock.module('node:child_process', () => ({ exec: mockExec }));
mock.module('child_process', () => ({ exec: mockExec }));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { installWorktreeDependencies } = await import('./dependency-installer');

const TMP_ROOT = resolve('.tmp-tests/dependency-installer');

async function makePackageDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"test"}');
  await writeFile(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
}

describe('installWorktreeDependencies', () => {
  beforeEach(async () => {
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
    await rm(TMP_ROOT, { recursive: true, force: true });
    await mkdir(TMP_ROOT, { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP_ROOT, { recursive: true, force: true });
  });

  test('installs in every subdirectory containing package.json + pnpm-lock.yaml', async () => {
    const worktree = join(TMP_ROOT, 'wt1');
    await mkdir(worktree, { recursive: true });
    await makePackageDir(join(worktree, 'rapitas-frontend'));
    await makePackageDir(join(worktree, 'rapitas-backend'));

    await installWorktreeDependencies(worktree);

    const cwds = mockExec.mock.calls.map((call) => {
      const opts = call[1] as { cwd?: string } | undefined;
      return opts?.cwd;
    });
    expect(cwds).toContain(join(worktree, 'rapitas-frontend'));
    expect(cwds).toContain(join(worktree, 'rapitas-backend'));
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  test('also installs at the worktree root when it has package.json + pnpm-lock.yaml', async () => {
    const worktree = join(TMP_ROOT, 'wt-root');
    await makePackageDir(worktree);

    await installWorktreeDependencies(worktree);

    const cwds = mockExec.mock.calls.map((call) => {
      const opts = call[1] as { cwd?: string } | undefined;
      return opts?.cwd;
    });
    expect(cwds).toContain(worktree);
  });

  test('skips directories missing pnpm-lock.yaml', async () => {
    const worktree = join(TMP_ROOT, 'wt-partial');
    await mkdir(worktree, { recursive: true });
    const noLock = join(worktree, 'no-lock');
    await mkdir(noLock, { recursive: true });
    await writeFile(join(noLock, 'package.json'), '{"name":"x"}');
    await makePackageDir(join(worktree, 'with-lock'));

    await installWorktreeDependencies(worktree);

    const cwds = mockExec.mock.calls.map((call) => {
      const opts = call[1] as { cwd?: string } | undefined;
      return opts?.cwd;
    });
    expect(cwds).toContain(join(worktree, 'with-lock'));
    expect(cwds).not.toContain(noLock);
  });

  test('ignores dotfiles, node_modules, and nested-only manifests', async () => {
    const worktree = join(TMP_ROOT, 'wt-skip');
    await mkdir(worktree, { recursive: true });
    await makePackageDir(join(worktree, '.cache'));
    await makePackageDir(join(worktree, 'node_modules'));
    await makePackageDir(join(worktree, 'rapitas-frontend', 'nested'));
    await makePackageDir(join(worktree, 'rapitas-frontend'));

    await installWorktreeDependencies(worktree);

    const cwds = mockExec.mock.calls.map((call) => {
      const opts = call[1] as { cwd?: string } | undefined;
      return opts?.cwd;
    });
    expect(cwds).toContain(join(worktree, 'rapitas-frontend'));
    expect(cwds).not.toContain(join(worktree, '.cache'));
    expect(cwds).not.toContain(join(worktree, 'node_modules'));
    expect(cwds).not.toContain(join(worktree, 'rapitas-frontend', 'nested'));
  });

  test('runs pnpm install with offline + frozen-lockfile flags', async () => {
    const worktree = join(TMP_ROOT, 'wt-flags');
    await makePackageDir(worktree);

    await installWorktreeDependencies(worktree);

    const command = mockExec.mock.calls[0]?.[0] as string;
    expect(command).toContain('pnpm install');
    expect(command).toContain('--offline');
    expect(command).toContain('--prefer-offline');
    expect(command).toContain('--frozen-lockfile');
  });

  test('throws when pnpm install fails', async () => {
    const worktree = join(TMP_ROOT, 'wt-fail');
    await makePackageDir(worktree);

    mockExec.mockImplementation(
      (
        _command: string,
        options: unknown,
        callback?: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const cb = (typeof options === 'function' ? options : callback) as
          | ((error: Error | null, stdout: string, stderr: string) => void)
          | undefined;
        cb?.(new Error('lockfile mismatch'), '', '');
        return { kill: mock(() => undefined) };
      },
    );

    await expect(installWorktreeDependencies(worktree)).rejects.toThrow(/pnpm install failed/);
  });

  test('no-ops when no installable manifest is found', async () => {
    const worktree = join(TMP_ROOT, 'wt-empty');
    await mkdir(worktree, { recursive: true });

    await installWorktreeDependencies(worktree);

    expect(mockExec).not.toHaveBeenCalled();
  });
});
