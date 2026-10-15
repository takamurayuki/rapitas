/**
 * worktree-guard-merge-cache.test
 *
 * recoverFromUnresolvedMerge の MERGE_HEAD 検知は execGitReadonly の TTL キャッシュ
 * (既定30秒) を経由する。abort 成功後にキャッシュを無効化しないと、同一ディレクトリへの
 * 2回目の呼び出し（createBranch → createCommit の連続呼び出し相当）が古い
 * 「MERGE_HEAD あり」判定を見て abort を再試行し、"There is no merge to abort" で
 * ERROR ログを吐く（task 731）。この回帰を再現・防止する。
 */
import { mock, describe, test, expect, beforeEach } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const errorCalls: unknown[][] = [];

// NOTE: 全エクスポートをミラーすること（bun の mock.module はプロセスグローバルで
// 汚染しうるため、他ファイルの実装と同じ形にして齟齬を避ける）。
mock.module('../../../../../config/logger', () => ({
  getBackendLogFilePath: (_stamp: string) => '/test/logs/backend.log',
  logger: {
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: (_b: unknown) => ({}),
  },
  createLogger: (_name: string) => ({
    warn: () => {},
    error: (...args: unknown[]) => {
      errorCalls.push(args);
    },
    info: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: (_b: unknown) => ({}),
  }),
}));

const { recoverFromUnresolvedMerge } = await import('./worktree-guard');

/** Create a temp repo left with an unresolved merge conflict (MERGE_HEAD set). */
function initRepoWithUnresolvedMerge(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wt-guard-merge-cache-'));
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

/** Best-effort recursive delete with retries — mirrors worktree-guard.test.ts. */
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

describe('recoverFromUnresolvedMerge — TTLキャッシュの陳腐化 (task 731)', () => {
  beforeEach(() => {
    errorCalls.length = 0;
  });

  test('2回連続呼び出しの2回目もERRORログを出さないこと', async () => {
    const dir = initRepoWithUnresolvedMerge();
    try {
      await expect(recoverFromUnresolvedMerge(dir)).resolves.toBe(true);
      expect(errorCalls.length).toBe(0);

      // Second call within the git-exec cache TTL window — MERGE_HEAD is
      // already resolved by the first call's real `git merge --abort`, so
      // this must return false WITHOUT retrying the abort (which would fail
      // with "There is no merge to abort" and log an ERROR).
      await expect(recoverFromUnresolvedMerge(dir)).resolves.toBe(false);
      expect(errorCalls.length).toBe(0);
    } finally {
      cleanupDir(dir);
    }
  });
});
