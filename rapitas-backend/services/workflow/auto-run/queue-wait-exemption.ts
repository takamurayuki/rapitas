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
}

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
    return otherRunning != null;
  } catch {
    return false;
  }
}
