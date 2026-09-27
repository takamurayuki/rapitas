/**
 * queue-starvation-waiters
 *
 * Weighs the `queued` side of the starvation signal: are the waiting items work
 * the runner could actually dispatch? Extracted from
 * workflow-reconciler-queue-stall.ts (file-size split); owns no detection
 * cadence, no kick, and no notification.
 *
 * Why weighing is needed at all: `running=0 かつ queued>0` read off the item
 * statuses alone is not evidence of a stuck dispatcher. Two very different
 * situations produce it — a phase running while its item sits back in `queued`,
 * and a queue whose every waiter is parked on a task the runner refuses. Both
 * fired the alert on healthy systems (measured 2026-09-27: seven in one day,
 * every one a halted, blocked, question-paused, or merge-awaiting task), and the
 * same alert is the only path a REAL wedge has to a human.
 */
import { prisma } from '../../config/database';
import { isTaskTerminalForQueue } from './workflow-queue';
import { hasLiveExecution } from './auto-run/auto-run-selection';

/** How many queued items to weigh before giving up on the scan. */
const WAITER_SCAN_LIMIT = 20;

/** Minimal task state needed to weigh one queued item. */
export interface WaiterTaskState {
  status: string;
  workflowStatus: string | null;
  haltReason: string | null;
}

/** What the queued side of the queue actually holds. */
export interface QueuedWaiters {
  /** A queued item's task has a live agent — a phase is running, not starving. / 実行中のフェーズがある */
  working: boolean;
  /** Queued items the runner could dispatch right now. / 発行可能な待機件数 */
  dispatchable: number;
}

/**
 * Whether a queued item's task is actually waiting to be DISPATCHED.
 *
 * Starvation means dispatchable work is waiting while nothing runs. An item
 * parked on a task the runner will refuse anyway is not evidence of a stuck
 * dispatcher.
 *
 * @param task - Minimal task state for a queued item. / キュー項目のタスク状態
 * @returns true when the runner could dispatch a phase for it. / 発行対象なら true
 */
export function isDispatchableWaiter(task: WaiterTaskState): boolean {
  if (isTaskTerminalForQueue(task)) return false;
  if (task.haltReason) return false;
  if (task.status === 'blocked') return false;
  if (task.workflowStatus === 'awaiting_question') return false;
  // verify_done is settled by the runner's own wait (and the auto-merge
  // watcher), never by dispatching an agent.
  if (task.workflowStatus === 'verify_done') return false;
  return true;
}

/**
 * Weigh the queued items behind a `running=0 かつ queued>0` observation.
 *
 * Fails toward ALERTING: whenever the queued items or their task states cannot
 * be read, every waiter counts as dispatchable, which reproduces the
 * pre-existing behaviour. Information we could not gather must never silence the
 * signal.
 *
 * @param queuedCount - Queued items per the caller's own count. / 呼び出し側が数えた待機件数
 * @returns Whether a phase is running, and how many waiters are dispatchable. / 実行中か、発行可能な件数
 */
export async function resolveQueuedWaiters(queuedCount: number): Promise<QueuedWaiters> {
  const queued = await prisma.workflowQueueItem
    .findMany({
      where: { status: 'queued' },
      orderBy: { queuedAt: 'asc' },
      take: WAITER_SCAN_LIMIT,
      select: { taskId: true },
    })
    .catch(() => [] as { taskId: number }[]);
  if (queued.length === 0) return { working: false, dispatchable: queuedCount };

  for (const item of queued) {
    if (await hasLiveExecution(prisma, item.taskId)) return { working: true, dispatchable: 0 };
  }

  const tasks = await prisma.task
    .findMany({
      where: { id: { in: queued.map((item) => item.taskId) } },
      select: { id: true, status: true, workflowStatus: true, haltReason: true },
    })
    .catch(() => null as (WaiterTaskState & { id: number })[] | null);
  if (!tasks) return { working: false, dispatchable: queued.length };

  const byId = new Map(tasks.map((task) => [task.id, task]));
  let dispatchable = 0;
  for (const item of queued) {
    const task = byId.get(item.taskId);
    // A vanished task is the vanished-task policy's business, not ours.
    if (!task || isDispatchableWaiter(task)) dispatchable++;
  }
  return { working: false, dispatchable };
}
