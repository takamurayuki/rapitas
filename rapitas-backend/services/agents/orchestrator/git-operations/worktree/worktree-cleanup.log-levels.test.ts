/**
 * worktree-cleanup.log-levels.test
 *
 * The orphan sweep logged two WARN lines per directory it was not allowed to
 * remove, again on the first sweep after every restart — 206 of 215 warnings
 * on 2026-11-16 (#1565). A refusal is the guard keeping work, so it is
 * summarised once per sweep at info; a directory with no Git metadata can
 * never be removed automatically, so it is not attempted and is reported to
 * a person once per process.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const calls: Record<'info' | 'warn' | 'debug' | 'error', string[]> = {
  info: [],
  warn: [],
  debug: [],
  error: [],
};
const record = (level: keyof typeof calls) => (a: unknown, b?: unknown) =>
  calls[level].push(String(typeof a === 'string' ? a : b));
mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({
    info: record('info'),
    warn: record('warn'),
    debug: record('debug'),
    error: record('error'),
  }),
}));

let sessions: Array<{ id: number; worktreePath: string; status: string }> = [];
mock.module('../../../../../config/database', () => ({
  prisma: {
    agentSession: {
      findMany: mock(async () => sessions),
      updateMany: mock(async () => ({ count: 0 })),
    },
  },
}));
const removeWorktree = mock(async () => false);
mock.module('./worktree-remove', () => ({ removeWorktree }));
mock.module('./worktree-terminal-sweep', () => ({ sweepTerminalTaskWorktrees: async () => 0 }));
mock.module('./worktree-filesystem-orphans', () => ({ sweepFilesystemOrphans: async () => 0 }));
mock.module('../core/resolve-worktree-base-dir', () => ({
  resolveWorktreeBaseDir: () => 'C:/repo',
}));
mock.module('../../../worktree-keep-list', () => ({
  computeWorktreeKeepPaths: async () => [],
  liveTaskWorktreePaths: async () => new Set<string>(),
}));

const { cleanupOrphanedWorktrees } = await import('./worktree-cleanup');
const { resetRemovalBackoff } = await import('./worktree-removal-backoff');

let root = '';
const dir = (name: string, withGit: boolean) => {
  const p = join(root, name);
  mkdirSync(p, { recursive: true });
  if (withGit) mkdirSync(join(p, '.git'));
  return p;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wt-log-levels-'));
  resetRemovalBackoff();
  for (const k of Object.keys(calls) as Array<keyof typeof calls>) calls[k].length = 0;
  removeWorktree.mockClear();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a refused removal', () => {
  test('is summarised once at info, not warned per directory', async () => {
    sessions = [
      { id: 1, worktreePath: dir('task-1-a', true), status: 'completed' },
      { id: 2, worktreePath: dir('task-2-b', true), status: 'failed' },
    ];
    await cleanupOrphanedWorktrees(root);
    expect(calls.warn).toEqual([]);
    expect(calls.info.filter((m) => m.includes('Kept 2 worktree(s)'))).toHaveLength(1);
  });
});

describe('a directory with no Git metadata', () => {
  test('is not attempted, and is reported once for a person', async () => {
    const lost = dir('task-3-c', false);
    sessions = [{ id: 3, worktreePath: lost, status: 'completed' }];
    await cleanupOrphanedWorktrees(root);
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(calls.warn).toHaveLength(1);
    expect(calls.warn[0]).toContain('delete by hand');
    expect(calls.warn[0]).toContain('task-3-c');

    // The next sweep in the same process does not repeat it.
    resetRemovalBackoff();
    calls.warn.length = 0;
    await cleanupOrphanedWorktrees(root);
    expect(calls.warn).toEqual([]);
  });
});
