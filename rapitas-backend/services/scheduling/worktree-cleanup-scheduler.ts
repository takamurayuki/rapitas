/**
 * WorktreeCleanupScheduler
 *
 * Periodic scheduler for cleaning up orphaned git worktrees.
 * Runs every 30 minutes by default to remove worktrees from completed/failed sessions
 * and orphaned filesystem directories that git no longer tracks.
 */

import { createLogger } from '../../config/logger';
import { cleanupOrphanedWorktrees } from '../agents/orchestrator/git-operations/worktree-ops';
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
