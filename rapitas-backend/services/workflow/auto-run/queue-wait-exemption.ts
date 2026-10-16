/**
 * QueueWaitExemption
 *
 * Tells the hang backstop whether a task is genuinely alive — a live
 * execution heartbeat OR simply waiting in the queue while the runner serves
 * ANOTHER task. Owns only that combined liveness answer; the tenure wall and
 * force-stop stay in auto-run-advance-active.
 *
 * Why the queued case matters: with concurrency 1, a task parked behind a
 * long neighbour has no transitions and no heartbeat, which the wall guard
 * read as "wedged" — 783/784 were force-stopped three times on 2026-08-31
 * while doing nothing but waiting their turn.
 */
import { createLogger } from '../../../config/logger';

const log = createLogger('theme-auto-run-scheduler');

/** Minimal prisma surface (lazy-loaded callers pass the real client). */
interface PrismaLike {
  workflowQueueItem: {
    findFirst(args: unknown): Promise<{ id: number } | null>;
  };
  agentExecution: {
    findFirst(args: unknown): Promise<{ id: number } | null>;
  };
}

// Mirrors HANG_BACKSTOP_HEARTBEAT_MS (auto-run-selection.ts); a local copy so
// this module's only import of that file stays the lazily-loaded liveness check.
const FRESH_HEARTBEAT_MS = 5 * 60_000;

/** Why {@link liveOrQueuedBehind} answered the way it did (logged every call). */
export type QueueWaitReason =
  | 'live_execution'
  | 'queued_behind_running'
  | 'queued_behind_live_exec'
  | 'no_own_queued'
  | 'no_other_running'
  | 'lookup_error';

/**
 * Decide liveness AND report which branch decided it.
 *
 * @param prisma - Prisma client. / Prisma クライアント
 * @param taskId - The wall-guard's current task. / 対象タスク
 * @returns Verdict plus reason code (and error text for lookup_error). / 判定と理由コード
 */
export async function explainQueueWait(
  prisma: unknown,
  taskId: number,
): Promise<{ waiting: boolean; reason: QueueWaitReason; error?: string }> {
  try {
    const { hasLiveExecution } = await import('./auto-run-selection');
    if (await hasLiveExecution(prisma as never, taskId)) {
      return { waiting: true, reason: 'live_execution' };
    }
    const p = prisma as PrismaLike;
    // Waiting its turn: own item still 'queued' AND someone else's is 'running'.
    const ownQueued = await p.workflowQueueItem.findFirst({
      where: { taskId, status: 'queued' },
      select: { id: true },
    } as never);
    if (!ownQueued) return { waiting: false, reason: 'no_own_queued' };
    const otherRunning = await p.workflowQueueItem.findFirst({
      where: { taskId: { not: taskId }, status: 'running' },
      select: { id: true },
    } as never);
    if (otherRunning != null) return { waiting: true, reason: 'queued_behind_running' };
    // A post-completion execution (ci_repair, continuation) holds the runner's
    // slot WITHOUT any queue item: task 856 waited 45 min behind task 847's
    // ci_repair, produced nothing, and was force-stopped as "wedged"
    // (2026-09-05). Any other task's live heartbeat means we are queued behind it.
    const otherLive = await p.agentExecution.findFirst({
      where: {
        status: 'running',
        heartbeatAt: { gte: new Date(Date.now() - FRESH_HEARTBEAT_MS) },
        session: { config: { taskId: { not: taskId } } },
      },
      select: { id: true },
    } as never);
    return otherLive != null
      ? { waiting: true, reason: 'queued_behind_live_exec' }
      : { waiting: false, reason: 'no_other_running' };
  } catch (err) {
    return {
      waiting: false,
      reason: 'lookup_error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Live execution heartbeat, or queued behind another task's active work.
 *
 * Fail-open on lookup errors (returns false → the wall guard keeps its old
 * behaviour rather than never firing). Every verdict is logged with its
 * reason: task 984 (2026-09-20) was blocked while waiting and nothing said
 * why the exemption answered false.
 *
 * @param prisma - Prisma client. / Prisma クライアント
 * @param taskId - The wall-guard's current task. / 対象タスク
 * @returns true when the task must not be treated as wedged. / ハング扱い禁止なら true
 */
export async function liveOrQueuedBehind(prisma: unknown, taskId: number): Promise<boolean> {
  const verdict = await explainQueueWait(prisma, taskId);
  try {
    const line = `[ThemeAutoRunScheduler] liveOrQueuedBehind(task ${taskId}) = ${verdict.waiting} (reason: ${verdict.reason}${
      verdict.error ? `, error: ${verdict.error}` : ''
    })`;
    if (verdict.waiting) log.info(line);
    else log.warn(line);
  } catch {
    // Logging must never change the verdict.
  }
  return verdict.waiting;
}
