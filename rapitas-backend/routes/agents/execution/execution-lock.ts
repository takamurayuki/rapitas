/**
 * execution/execution-lock
 *
 * In-memory mutex for preventing concurrent executions of the same task.
 * Locks auto-expire after 10 minutes to guard against leaked locks when a
 * worker crashes before the finally block can release.
 */

import { createLogger } from '../../../config/logger';

const log = createLogger('routes:agent-execution:lock');

/** Tracks currently locked tasks with the time the lock was acquired. */
const taskExecutionLocks = new Map<number, { lockedAt: Date; sessionId?: number }>();

/** Lock TTL: 10 minutes. Stale locks older than this are automatically released. */
const LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * Attempts to acquire an exclusive lock for a task execution.
 * Returns false if another execution is already in progress (and the lock
 * is not stale).
 *
 * @param taskId - The task ID to lock / ロック対象のタスクID
 * @returns true if the lock was acquired, false if already locked / ロック取得成功可否
 */
export function acquireTaskExecutionLock(taskId: number): boolean {
  if (taskExecutionLocks.has(taskId)) {
    const lock = taskExecutionLocks.get(taskId)!;
    const elapsed = Date.now() - lock.lockedAt.getTime();
    if (elapsed < LOCK_TTL_MS) {
      return false;
    }
    log.warn(`[ExecutionLock] Stale lock released for task ${taskId} (elapsed: ${elapsed}ms)`);
  }
  taskExecutionLocks.set(taskId, { lockedAt: new Date() });
  return true;
}

/**
 * Releases the execution lock for a task.
 *
 * @param taskId - The task ID to unlock / アンロック対象のタスクID
 */
export function releaseTaskExecutionLock(taskId: number): void {
  taskExecutionLocks.delete(taskId);
  log.info(`[ExecutionLock] Lock released for task ${taskId}`);
}
