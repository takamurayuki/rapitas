/**
 * worktree-preflight.test
 *
 * Covers preflightWorktree's three axes: setup script present/absent,
 * node_modules present/absent, package.json present/absent — and the
 * fail-fast vs warn-only behaviour each combination should produce.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

let execShouldFail: Error | null = null;

const execMock = mock(
  (command: string, options: unknown, callback?: (e: Error | null, r?: unknown) => void) => {
    const cb = (typeof options === 'function' ? options : callback) as
      | ((e: Error | null, r?: unknown) => void)
      | undefined;
    cb?.(execShouldFail, { stdout: '', stderr: '' });
    return { kill: mock(() => undefined) };
  },
);
// NOTE: execFile is unused by worktree-preflight.ts, but mock.module is
// process-global for the test run — mirroring it keeps sibling git-operations
// test files (which import execFile) resolvable if run in the same process.
const execFileMock = mock(() => ({ kill: mock(() => undefined) }));
mock.module('node:child_process', () => ({ exec: execMock, execFile: execFileMock }));
mock.module('child_process', () => ({ exec: execMock, execFile: execFileMock }));

const warnCalls: unknown[][] = [];
const infoCalls: unknown[][] = [];
mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => {
      infoCalls.push(args);
    },
    warn: (...args: unknown[]) => {
      warnCalls.push(args);
    },
    error: () => {},
    debug: () => {},
  }),
}));

const { preflightWorktree } = await import('./worktree-preflight');

const TMP_ROOT = resolve('.tmp-tests/worktree-preflight');

/** Builds a worktree directory with the requested combination of artifacts. */
async function makeWorktree(
  name: string,
  opts: { withScript?: boolean; withPackageJson?: boolean; withNodeModules?: boolean },
): Promise<string> {
  const dir = join(TMP_ROOT, name);
  await mkdir(dir, { recursive: true });
  if (opts.withScript) {
    await mkdir(join(dir, 'scripts'), { recursive: true });
    await writeFile(join(dir, 'scripts', 'setup-worktree.cjs'), '// stub setup-worktree');
  }
  if (opts.withPackageJson) {
    await writeFile(join(dir, 'package.json'), '{}');
  }
  if (opts.withNodeModules) {
    await mkdir(join(dir, 'node_modules'), { recursive: true });
  }
  return dir;
}

beforeEach(async () => {
  execShouldFail = null;
  execMock.mockClear();
  warnCalls.length = 0;
  infoCalls.length = 0;
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe('preflightWorktree — setup script present', () => {
  test('runs the script and resolves when node_modules ends up linked', async () => {
    const dir = await makeWorktree('linked-ok', {
      withScript: true,
      withPackageJson: true,
      withNodeModules: true,
    });

    await expect(preflightWorktree(dir)).resolves.toBeUndefined();

    expect(execMock).toHaveBeenCalledTimes(1);
    const command = execMock.mock.calls[0]?.[0] as string;
    expect(command).toContain('setup-worktree.cjs');
    expect(command).toContain('node');
    expect(infoCalls.length).toBe(1);
  });

  test('throws when node_modules is still missing after the script runs (package.json present)', async () => {
    const dir = await makeWorktree('linked-missing', {
      withScript: true,
      withPackageJson: true,
      withNodeModules: false,
    });

    await expect(preflightWorktree(dir)).rejects.toThrow(/node_modules がリンクされていません/);
  });

  test('does not require node_modules when there is no package.json', async () => {
    const dir = await makeWorktree('no-package-json', {
      withScript: true,
      withPackageJson: false,
      withNodeModules: false,
    });

    await expect(preflightWorktree(dir)).resolves.toBeUndefined();
  });

  test('throws an actionable error when the script itself fails', async () => {
    execShouldFail = new Error('boom: link failed');
    const dir = await makeWorktree('script-fails', {
      withScript: true,
      withPackageJson: true,
      withNodeModules: true,
    });

    await expect(preflightWorktree(dir)).rejects.toThrow(/worktree のセットアップ/);
    await expect(preflightWorktree(dir)).rejects.toThrow(/boom: link failed/);
  });
});

describe('preflightWorktree — no setup script', () => {
  test('warns but does not throw when node_modules is missing and package.json is present', async () => {
    const dir = await makeWorktree('unmanaged-missing', {
      withScript: false,
      withPackageJson: true,
      withNodeModules: false,
    });

    await expect(preflightWorktree(dir)).resolves.toBeUndefined();

    expect(warnCalls.length).toBe(1);
    expect(execMock).not.toHaveBeenCalled();
  });

  test('does not warn when node_modules is already present', async () => {
    const dir = await makeWorktree('unmanaged-present', {
      withScript: false,
      withPackageJson: true,
      withNodeModules: true,
    });

    await expect(preflightWorktree(dir)).resolves.toBeUndefined();

    expect(warnCalls.length).toBe(0);
  });

  test('does not warn when there is no package.json (nothing to link)', async () => {
    const dir = await makeWorktree('unmanaged-no-package-json', {
      withScript: false,
      withPackageJson: false,
      withNodeModules: false,
    });

    await expect(preflightWorktree(dir)).resolves.toBeUndefined();

    expect(warnCalls.length).toBe(0);
  });
});
