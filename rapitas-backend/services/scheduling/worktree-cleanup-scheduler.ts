/**
 * WorktreeCleanupScheduler
 *
 * Periodic scheduler for cleaning up orphaned git worktrees.
 * Runs every 30 minutes by default to remove worktrees from completed/failed sessions
 * and orphaned filesystem directories that git no longer tracks, idle named
 * worktrees whose work is preserved, and old workflow scratch files, then
 * prunes local branches whose work is provably preserved (#1403).
 */

import { createLogger } from '../../config/logger';
import { cleanupOrphanedWorktrees } from '../agents/orchestrator/git-operations/worktree/worktree-ops';
import {
  pruneMergedLocalBranches,
  sweepIdleWorktrees,
  sweepScratchFiles,
} from '../agents/orchestrator/git-operations/branch-hygiene';
import { getProjectRoot } from '../../config';

const logger = createLogger('worktree-cleanup-scheduler');

export class WorktreeCleanupScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly defaultIntervalMs = 30 * 60 * 1000; // 30 minutes

  /**
   * Start the periodic worktree cleanup scheduler.
   *
   * @param intervalMs - Cleanup interval in milliseconds / クリーンアップ間隔（ミリ秒）
   * @param baseDir - Repository base directory (optional, defaults to project root) / リポジトリベースディレクトリ（任意、デフォルトはプロジェクトルート）
   */
  start(intervalMs?: number, baseDir?: string): void {
    if (this.isRunning) {
      logger.warn('[WorktreeCleanupScheduler] Already running, ignoring start request');
      return;
    }

    const interval = intervalMs ?? this.defaultIntervalMs;
    const workingDir = baseDir ?? getProjectRoot();

    logger.info(
      `[WorktreeCleanupScheduler] Starting scheduler with ${interval}ms interval for ${workingDir}`,
    );

    this.isRunning = true;

    // Run initial cleanup immediately
    this.runCleanup(workingDir).catch((error) => {
      logger.error({ err: error }, '[WorktreeCleanupScheduler] Initial cleanup failed');
    });

    // Schedule periodic cleanups
    this.intervalId = setInterval(() => {
      this.runCleanup(workingDir).catch((error) => {
        logger.error({ err: error }, '[WorktreeCleanupScheduler] Scheduled cleanup failed');
      });
    }, interval);

    logger.info('[WorktreeCleanupScheduler] Started successfully');
  }

  /**
   * Stop the periodic worktree cleanup scheduler.
   */
  stop(): void {
    if (!this.isRunning) {
      logger.debug('[WorktreeCleanupScheduler] Not running, ignoring stop request');
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    logger.info('[WorktreeCleanupScheduler] Stopped');
  }

  /**
   * Check if the scheduler is currently running.
   *
   * @returns True if running / 実行中の場合true
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Run a single cleanup cycle.
   *
   * @param baseDir - Repository base directory / リポジトリベースディレクトリ
   */
  private async runCleanup(baseDir: string): Promise<void> {
    try {
      logger.debug('[WorktreeCleanupScheduler] Running cleanup cycle');
      const cleanedCount = await cleanupOrphanedWorktrees(baseDir);

      if (cleanedCount > 0) {
        logger.info(
          `[WorktreeCleanupScheduler] Cleanup cycle completed: ${cleanedCount} worktrees cleaned`,
        );
      } else {
        logger.debug(
          '[WorktreeCleanupScheduler] Cleanup cycle completed: no orphaned worktrees found',
        );
      }
    } catch (error) {
      logger.error({ err: error }, '[WorktreeCleanupScheduler] Cleanup cycle failed');
      // Don't throw - let the scheduler continue running
    }

    // Named worktrees (people, Codex, Claude Code sub-agents) and leftover temp
    // ratchet worktrees: the task cleanup above never looks at them, so they
    // piled up (18 on 2026-11-14). Separate try, like the prune below.
    try {
      const swept = await sweepIdleWorktrees(baseDir);
      logger.info(
        { examined: swept.examined, removed: swept.removed.length, skipped: swept.skipped },
        '[WorktreeCleanupScheduler] Idle worktree sweep completed',
      );
    } catch (error) {
      logger.error({ err: error }, '[WorktreeCleanupScheduler] Idle worktree sweep failed');
    }

    try {
      await sweepScratchFiles(baseDir);
    } catch (error) {
      logger.error({ err: error }, '[WorktreeCleanupScheduler] Scratch file sweep failed');
    }

    // After the worktree sweeps, so branches they just released are judged too.
    // Separate try: a branch-prune failure must not read as a worktree failure.
    try {
      const pruned = await pruneMergedLocalBranches(baseDir);
      logger.info(
        {
          examined: pruned.examined,
          deleted: pruned.deleted.length,
          kept: pruned.kept,
          skipped: pruned.skipped,
        },
        '[WorktreeCleanupScheduler] Local branch prune completed',
      );
    } catch (error) {
      logger.error({ err: error }, '[WorktreeCleanupScheduler] Local branch prune failed');
    }
  }
}

// Singleton instance for global use
let globalScheduler: WorktreeCleanupScheduler | null = null;

/**
 * Get the global worktree cleanup scheduler instance.
 *
 * @returns Global scheduler instance / グローバルスケジューラインスタンス
 */
export function getWorktreeCleanupScheduler(): WorktreeCleanupScheduler {
  if (!globalScheduler) {
    globalScheduler = new WorktreeCleanupScheduler();
  }
  return globalScheduler;
}

/**
 * Start the global worktree cleanup scheduler.
 *
 * @param intervalMs - Optional cleanup interval in milliseconds / オプションのクリーンアップ間隔（ミリ秒）
 * @param baseDir - Optional repository base directory / オプションのリポジトリベースディレクトリ
 */
export function startWorktreeCleanupScheduler(intervalMs?: number, baseDir?: string): void {
  const scheduler = getWorktreeCleanupScheduler();
  scheduler.start(intervalMs, baseDir);
}

/**
 * Stop the global worktree cleanup scheduler.
 */
export function stopWorktreeCleanupScheduler(): void {
  const scheduler = getWorktreeCleanupScheduler();
  scheduler.stop();
}
