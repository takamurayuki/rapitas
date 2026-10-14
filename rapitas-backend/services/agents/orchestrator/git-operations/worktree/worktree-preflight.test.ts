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
  opts: {
    withScript?: boolean;
    withPackageJson?: boolean;
    withNodeModules?: boolean;
    withPartialNodeModules?: boolean;
  },
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
    // `.bin` makes it a COMPLETE install rather than a bare directory — an empty
    // node_modules resolves nothing, so the preflight must not read it as ready.
    await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
  }
  if (opts.withPartialNodeModules) {
    // ContextFlow #1215's measured shape: pnpm's store and nothing else.
    await mkdir(join(dir, 'node_modules', '.pnpm'), { recursive: true });
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

// 実測した配管の欠落（2026-10-13）。
//
// `bootstrapProjectDependencies` は「プロジェクトルートで install → worktree に
// node_modules をリンク」を正しく行うが、本番の呼び出し元は test-triage だけで、
// **worktree 作成時には一度も呼ばれていなかった**。setup-worktree.cjs を持たない
// プロジェクト（= 生成プロジェクト全部）では preflight が警告するだけで続行する。
//
// 実測: 本日のバックエンドログで `projectBootstrap` 0 回 / `installWorktreeDependencies`
// 0 回に対し `[preflight] node_modules is absent` が 3 回。ContextFlow #1215 の
// worktree は依存ゼロで起動し、07:06 の runtime-smoke が `next` を解決できず
// `unverifiable; completion withheld` になり、エージェントが 07:13〜07:19 に
// 403MB を自分でインストールして埋めた。警告は読む者がいなければ配管ではない。
describe('preflightWorktree — no setup script', () => {
  test('prepares the project dependencies when node_modules is missing', async () => {
    const dir = await makeWorktree('unmanaged-missing', {
      withScript: false,
      withPackageJson: true,
      withNodeModules: false,
    });
    const bootstrap = mock(() => Promise.resolve({ action: 'linked', detail: '1 link(s): .' }));

    await expect(preflightWorktree(dir, { bootstrap })).resolves.toBeUndefined();

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(bootstrap.mock.calls[0]).toEqual([dir]);
    // Still no setup script run — this path never had one.
    expect(execMock).not.toHaveBeenCalled();
  });

  // The #1215 shape specifically: node_modules EXISTS but holds only pnpm's
  // store, so existsSync said "ready" while nothing could resolve.
  test('prepares the dependencies when node_modules exists but is a partial install', async () => {
    const dir = await makeWorktree('unmanaged-partial', {
      withScript: false,
      withPackageJson: true,
      withPartialNodeModules: true,
    });
    const bootstrap = mock(() => Promise.resolve({ action: 'installed', detail: 'pnpm install' }));

    await expect(preflightWorktree(dir, { bootstrap })).resolves.toBeUndefined();

    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  test('warns but does not throw when the preparation fails', async () => {
    // An unmanaged project must not be hard-blocked by a package-manager
    // failure: the agent can still install for itself, as it did before this
    // path existed. Throwing here would turn a recoverable environment into a
    // dead task.
    const dir = await makeWorktree('unmanaged-broken', {
      withScript: false,
      withPackageJson: true,
      withNodeModules: false,
    });
    const bootstrap = mock(() => Promise.reject(new Error('pnpm install failed: ENOSPC')));

    await expect(preflightWorktree(dir, { bootstrap })).resolves.toBeUndefined();

    expect(warnCalls.length).toBe(1);
    // The cause has to reach the log, or the operator sees only "could not prepare".
    // (JSON.stringify would render an Error as {}, so read the field.)
    const logged = warnCalls[0][0] as { err?: Error };
    expect(logged.err?.message).toContain('ENOSPC');
  });

  test('does nothing when node_modules is already a complete install', async () => {
    const dir = await makeWorktree('unmanaged-present', {
      withScript: false,
      withPackageJson: true,
      withNodeModules: true,
    });
    const bootstrap = mock(() => Promise.resolve({ action: 'skipped', detail: '' }));

    await expect(preflightWorktree(dir, { bootstrap })).resolves.toBeUndefined();

    expect(bootstrap).not.toHaveBeenCalled();
    expect(warnCalls.length).toBe(0);
  });

  test('does nothing when there is no package.json (nothing to prepare)', async () => {
    const dir = await makeWorktree('unmanaged-no-package-json', {
      withScript: false,
      withPackageJson: false,
      withNodeModules: false,
    });
    const bootstrap = mock(() => Promise.resolve({ action: 'skipped', detail: '' }));

    await expect(preflightWorktree(dir, { bootstrap })).resolves.toBeUndefined();

    expect(bootstrap).not.toHaveBeenCalled();
    expect(warnCalls.length).toBe(0);
  });
});
