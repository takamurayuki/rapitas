/**
 * task-execution-lock
 *
 * Process-wide in-memory mutex that guarantees AT MOST ONE agent run per task
 * at a time. This is the single source of truth shared by BOTH the manual
 * execution routes (execute / continue) AND the workflow orchestrator
 * (advanceWorkflow), so a manual "run" and an auto-run phase can never spawn a
 * second agent for the same task concurrently.
 *
 * Locks auto-expire after a TTL to guard against leaked locks when a worker
 * crashes before the release path runs.
 */

import { createLogger } from '../../config/logger';
import { getWorkflowLockTtlMs } from './execution-timeouts';
import { prisma } from '../../config/database';

const log = createLogger('task-execution-lock');

/** Tracks currently locked tasks with the time the lock was acquired. */
const taskExecutionLocks = new Map<number, { lockedAt: Date; expiresAt: number; owner: symbol }>();
const cancellationVersions = new Map<number, number>();

/**
 * taskIds a background DB hydration has already been kicked off for (task
 * 881) — at most one `Task.executionGenerationId` read per taskId per
 * process lifetime, not per call.
 */
const hydratedFromDb = new Set<number>();

/**
 * Read-through cache population (task 881): fires (once per taskId per
 * process) a non-blocking read of the DB's durable `Task.executionGenerationId`
 * and merges it into `cancellationVersions` by taking the MAX of the two —
 * the DB is the source of truth across process restarts / multiple workers,
 * but a same-process increment that already advanced the in-memory value
 * (via {@link incrementTaskGenerationId}/{@link releaseTaskExecutionLock})
 * must never be regressed by a DB read that simply hasn't caught up yet.
 * Deliberately fire-and-forget: {@link getTaskExecutionCancellationVersion}'s
 * signature stays synchronous (10+ call sites — see
 * {@link incrementTaskGenerationId}'s doc for why), so the FIRST call after a
 * fresh process still returns the in-memory value (0 for a never-touched
 * taskId) while this hydration is in flight; subsequent calls reflect the
 * DB-durable generation once it resolves (typically single-digit ms).
 *
 * @param taskId - Task whose generation to hydrate from the DB. / DBから世代を取り込む対象タスクID
 */
function hydrateGenerationFromDb(taskId: number): void {
  if (hydratedFromDb.has(taskId)) return;
  hydratedFromDb.add(taskId);
  // Task.executionGenerationId is pending Prisma client regen — see the
  // pending-column cast note on incrementTaskGenerationId below.
  const taskModel = prisma.task as unknown as {
    findUnique: (args: {
      where: { id: number };
      select: { executionGenerationId: true };
    }) => Promise<{ executionGenerationId: number } | null>;
  };
  // Promise.resolve().then(...) so a synchronous throw (e.g. a partially mocked
  // or not-yet-initialised prisma client) becomes a rejection handled below —
  // this sync getter sits inside releaseTaskExecutionLock and must never throw.
  Promise.resolve()
    .then(() =>
      taskModel.findUnique({ where: { id: taskId }, select: { executionGenerationId: true } }),
    )
    .then((row) => {
      if (!row) return;
      const current = cancellationVersions.get(taskId) ?? 0;
      if (row.executionGenerationId > current) {
        cancellationVersions.set(taskId, row.executionGenerationId);
      }
    })
    .catch((err) => {
      log.warn(
        { err, taskId },
        '[TaskExecutionLock] Failed to hydrate execution generation from DB',
      );
      // Allow a retry on a future call — a transient DB blip must not
      // permanently strand this taskId on the in-memory-only value.
      hydratedFromDb.delete(taskId);
    });
}

/** Survives normal lease release so deferred next-phase callbacks can observe a stop. */
export function getTaskExecutionCancellationVersion(taskId: number): number {
  hydrateGenerationFromDb(taskId);
  return cancellationVersions.get(taskId) ?? 0;
}

/**
 * Lock TTL must OUTLIVE a phase so a long phase never has its lock stolen
 * mid-run (which would spawn a duplicate agent). Derived from the phase timeout
 * (see execution-timeouts) so the three timeouts stay consistent — previously a
 * 15-min lock paired with a 10-min phase, both of which a >10-min legitimate
 * phase blew past. Both the manual routes and the workflow path use this.
 */
export const DEFAULT_LOCK_TTL_MS = getWorkflowLockTtlMs();
export const WORKFLOW_LOCK_TTL_MS = getWorkflowLockTtlMs();

/**
 * Attempts to acquire an exclusive lock for a task execution.
 * Returns false if another execution is already in progress (and the lock is
 * not stale).
 *
 * @param taskId - The task ID to lock / ロック対象のタスクID
 * @param ttlMs - Lock time-to-live in ms / ロックの有効期限（ミリ秒）
 * @returns true if the lock was acquired, false if already locked / ロック取得成功可否
 */
export function acquireTaskExecutionLock(
  taskId: number,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
): boolean {
  const existing = taskExecutionLocks.get(taskId);
  if (existing) {
    if (Date.now() < existing.expiresAt) {
      return false;
    }
    log.warn(`[TaskExecutionLock] Stale lock released for task ${taskId}`);
  }
  taskExecutionLocks.set(taskId, {
    lockedAt: new Date(),
    expiresAt: Date.now() + ttlMs,
    owner: Symbol(),
  });
  return true;
}

/**
 * Releases the execution lock for a task.
 *
 * @param taskId - The task ID to unlock / アンロック対象のタスクID
 */
export function releaseTaskExecutionLock(taskId: number, owner?: symbol): void {
  if (owner === undefined) {
    cancellationVersions.set(taskId, getTaskExecutionCancellationVersion(taskId) + 1);
  }
  if (owner !== undefined && taskExecutionLocks.get(taskId)?.owner !== owner) return;
  if (taskExecutionLocks.delete(taskId)) {
    log.info(`[TaskExecutionLock] Lock released for task ${taskId}`);
  }
}

/** Capture the current lease identity; stopping or replacing it invalidates the identity. */
export function getTaskExecutionLockOwner(taskId: number): symbol | undefined {
  return isTaskExecutionLocked(taskId) ? taskExecutionLocks.get(taskId)?.owner : undefined;
}

/**
 * Reports whether a task currently holds a (non-stale) execution lock.
 *
 * @param taskId - The task ID to check / 確認対象のタスクID
 * @returns true when an execution is in progress for the task / 実行中かどうか
 */
export function isTaskExecutionLocked(taskId: number): boolean {
  const existing = taskExecutionLocks.get(taskId);
  if (!existing) return false;
  if (Date.now() >= existing.expiresAt) {
    taskExecutionLocks.delete(taskId);
    return false;
  }
  return true;
}

/**
 * Atomically increment `Task.executionGenerationId` (task 881) — the durable,
 * cross-process source of truth for "which run of this task is current".
 * `cancellationVersions` above stays the in-process signal deferred
 * same-process continuations already check (its sync getter cannot read the
 * DB without becoming async, which would ripple through 10+ call sites — see
 * plan.md §実行世代ID(generation id)の設計); this function only ADDS the
 * durable DB counter alongside it, incrementing both so a caller reading
 * either sees the new generation. Callers that need cross-process/restart
 * safety (e.g. stale-recovery-helpers.ts) read Task.executionGenerationId
 * directly instead of the in-process map.
 *
 * @param taskId - Task whose generation just ended (e.g. a user stop). / 対象タスクID
 * @returns The new generation value, or null on a DB failure (fail-open — the caller must not block on this). / 新しい世代値
 */
export async function incrementTaskGenerationId(taskId: number): Promise<number | null> {
  try {
    // Task.executionGenerationId was just added to prisma/schema/core.prisma —
    // the generated client is pending regen until the next server restart
    // (CLAUDE.md forbids running `prisma generate` manually). Narrow cast on
    // the model only, same pending-column pattern as stale-recovery-helpers.ts.
    const taskModel = prisma.task as unknown as {
      update: (args: {
        where: { id: number };
        data: { executionGenerationId: { increment: number } };
        select: { executionGenerationId: true };
      }) => Promise<{ executionGenerationId: number }>;
    };
    const updated = await taskModel.update({
      where: { id: taskId },
      data: { executionGenerationId: { increment: 1 } },
      select: { executionGenerationId: true },
    });
    // Mirror the DB's atomic result exactly rather than blindly "local + 1" —
    // the in-memory cache may be behind the DB (e.g. hydration hasn't landed
    // yet), and re-deriving from a stale local value would desync the two.
    const current = getTaskExecutionCancellationVersion(taskId);
    cancellationVersions.set(taskId, Math.max(current, updated.executionGenerationId));
    return updated.executionGenerationId;
  } catch (err) {
    log.warn({ err, taskId }, '[TaskExecutionLock] Failed to increment execution generation id');
    return null;
  }
}
