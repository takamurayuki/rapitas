/**
 * DirRemoveRetry
 *
 * Low-level, dependency-free directory removal helper with retry, shared by
 * worktree-remove.ts and worktree-cleanup.ts.
 * Not responsible for git worktree bookkeeping — callers handle that.
 */

import * as fsPromises from 'node:fs/promises';
import { createLogger } from '../../../../../config/logger';

const logger = createLogger('git-operations/worktree-ops');

/**
 * Remove a directory with exponential-backoff retry to absorb Windows EBUSY errors.
 * Does NOT throw — callers decide how to handle a false return value.
 *
 * @param dirPath - Absolute path to remove / 削除する絶対パス
 * @param opts.maxAttempts - Maximum attempts before giving up (default: 5) / 最大試行回数（デフォルト: 5）
 * @param opts.sleepFn - Delay function between retries; inject a no-op in tests to avoid real waits / テスト時に即時解決の関数を渡してリアル待機を回避できる
 * @returns true when removal succeeded, false when all attempts failed / 成功でtrue、全失敗でfalse
 */
export async function rmDirWithRetry(
  dirPath: string,
  opts?: { maxAttempts?: number; sleepFn?: (ms: number) => Promise<void> },
): Promise<boolean> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  // NOTE: Default uses exponential backoff (1 s, 2 s, 3 s, 4 s…). Override in tests.
  const sleepFn = opts?.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fsPromises.rm(dirPath, { recursive: true, force: true });
      return true;
    } catch (err) {
      if (attempt < maxAttempts) {
        logger.debug(
          { err, attempt, maxAttempts, dirPath },
          `[rmDirWithRetry] rm attempt ${attempt}/${maxAttempts} failed, retrying in ${attempt}s`,
        );
        await sleepFn(1000 * attempt);
      } else {
        logger.warn(
          { err, dirPath },
          `[rmDirWithRetry] All ${maxAttempts} attempts failed for ${dirPath}`,
        );
      }
    }
  }
  return false;
}
