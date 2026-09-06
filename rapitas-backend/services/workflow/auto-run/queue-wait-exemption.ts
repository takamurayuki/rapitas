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

/**
 * Live execution heartbeat, or queued behind another task's active work.
 *
 * Fail-open on lookup errors (returns false → the wall guard keeps its old
 * behaviour rather than never firing).
 *
 * @param prisma - Prisma client. / Prisma クライアント
 * @param taskId - The wall-guard's current task. / 対象タスク
 * @returns true when the task must not be treated as wedged. / ハング扱い禁止なら true
 */
export async function liveOrQueuedBehind(prisma: unknown, taskId: number): Promise<boolean> {
  try {
    const { hasLiveExecution } = await import('./auto-run-selection');
    if (await hasLiveExecution(prisma as never, taskId)) return true;
    const p = prisma as PrismaLike;
    // Waiting its turn: own item still 'queued' AND someone else's is 'running'.
    const ownQueued = await p.workflowQueueItem.findFirst({
      where: { taskId, status: 'queued' },
      select: { id: true },
    } as never);
    if (!ownQueued) return false;
    const otherRunning = await p.workflowQueueItem.findFirst({
      where: { taskId: { not: taskId }, status: 'running' },
      select: { id: true },
    } as never);
    if (otherRunning != null) return true;
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
    return otherLive != null;
  } catch {
    return false;
  }
}
