/**
 * blocked-retry-handoff
 *
 * Re-dispatches a todo/draft task stranded by a failed `blocked_auto_retry`
 * re-dispatch and, after a bounded number of unselected attempts, hands it back
 * to `blocked` so the escalation pipeline owns it.
 * NOT responsible for the first reset/dispatch (see blocked-retry-dispatch).
 *
 * Why: once MAX_BLOCKED_RETRY is spent, a reset draft that was never selected has
 * no owner — requeueBlockedTasks only reads `status=blocked` — so it sat idle
 * until the stagnation detector re-filed it every cycle (task 1262, #1237).
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { ensureRetryDispatch, type RetryDispatchDeps } from './blocked-retry-dispatch';
import {
  BLOCKED_RETRY_HANDOFF_CAUSE,
  BLOCKED_RETRY_REDISPATCH_CAUSE,
  MAX_RETRY_REDISPATCH,
  RETRY_REDISPATCH_GRACE_MS,
} from './blocked-task-policy';

const log = createLogger('blocked-retry-handoff');

const LIVE_EXEC = ['running', 'pending', 'waiting_for_input'];
const LIVE_QUEUE = ['queued', 'running', 'waiting_approval'];

/**
 * Settle stranded retry drafts: re-dispatch, or hand off to blocked at the cap.
 * Never throws; one task's failure does not stop the others.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param nowMs - Current time (ms). / 現在時刻
 * @param deps - Optional selector override for tests. / テスト用差し替え
 * @returns Number of tasks handed off to blocked. / blocked へ引き渡した件数
 */
export async function settleStrandedRetryDrafts(
  prisma: PrismaClient,
  nowMs: number,
  deps: RetryDispatchDeps = {},
): Promise<number> {
  let handedOff = 0;
  try {
    const candidates = await prisma.task.findMany({
      where: {
        status: 'todo',
        workflowStatus: 'draft',
        parentId: null,
        autoRunExcluded: false,
        haltReason: null,
      },
      select: { id: true, themeId: true },
    });
    for (const task of candidates) {
      try {
        if (await settleOne(prisma, task, nowMs, deps)) handedOff++;
      } catch (err) {
        log.warn({ err, taskId: task.id }, '[blocked-retry-handoff] settle failed — skipping');
      }
    }
  } catch (err) {
    log.warn({ err }, '[blocked-retry-handoff] scan failed — fail-open');
  }
  return handedOff;
}

async function settleOne(
  prisma: PrismaClient,
  task: { id: number; themeId: number | null },
  nowMs: number,
  deps: RetryDispatchDeps,
): Promise<boolean> {
  // Only drafts our own retry path produced; other draft origins are not ours.
  const latest = await prisma.workflowTransition.findFirst({
    where: { taskId: task.id },
    orderBy: { createdAt: 'desc' },
    select: { cause: true, createdAt: true },
  });
  if (latest?.cause !== 'blocked_auto_retry' && latest?.cause !== BLOCKED_RETRY_REDISPATCH_CAUSE) {
    return false;
  }
  // NOTE: grace is measured from the newest transition, not Task.updatedAt —
  // bumping updatedAt would also reset the stagnation detector's staleness clock,
  // and an age cap would exclude long-stranded drafts such as #1237.
  if (nowMs - latest.createdAt.getTime() < RETRY_REDISPATCH_GRACE_MS) return false;

  const live = await prisma.agentExecution.findFirst({
    where: { session: { config: { taskId: task.id } }, status: { in: LIVE_EXEC } },
    select: { id: true },
  });
  if (live) return false;
  const queued = await prisma.workflowQueueItem.findFirst({
    where: { taskId: task.id, status: { in: LIVE_QUEUE } },
    select: { id: true },
  });
  if (queued) return false;

  // A task without a theme can never be picked by the theme selector.
  if (task.themeId == null) return handoff(prisma, task.id, 0, 'no_theme');

  const outcome = await ensureRetryDispatch(prisma, task as { id: number; themeId: number }, deps);
  // slot_busy / theme_not_running / error are legitimate or transient waits —
  // counting them would block healthy tasks, so they neither count nor hand off.
  if (outcome !== 'kicked' && outcome !== 'not_selected') return false;

  const lastReset = await prisma.workflowTransition.findFirst({
    where: { taskId: task.id, cause: 'blocked_auto_retry' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  // NOTE: n counts only not_selected attempts — a kicked row carries the prior n
  // unchanged, so an earlier kick never brings the handoff forward.
  const lastRedispatch = await prisma.workflowTransition.findFirst({
    where: {
      taskId: task.id,
      cause: BLOCKED_RETRY_REDISPATCH_CAUSE,
      ...(lastReset ? { createdAt: { gt: lastReset.createdAt } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true },
  });
  const prior = readCount(lastRedispatch?.metadata);
  const n = outcome === 'not_selected' ? prior + 1 : prior;
  await recordTransition({
    taskId: task.id,
    fromStatus: 'draft',
    toStatus: 'draft',
    actor: 'system',
    cause: BLOCKED_RETRY_REDISPATCH_CAUSE,
    metadata: { dispatch: outcome, n },
  }).catch(() => {});

  if (outcome === 'kicked') return false;
  if (n >= MAX_RETRY_REDISPATCH) return handoff(prisma, task.id, n, 'not_selected');
  return false;
}

function readCount(metadata: string | null | undefined): number {
  try {
    const n = (JSON.parse(metadata ?? '{}') as { n?: unknown }).n;
    return typeof n === 'number' && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function handoff(
  prisma: PrismaClient,
  taskId: number,
  n: number,
  reason: string,
): Promise<boolean> {
  // NOTE: conditional update — a concurrent pass that already moved the task wins.
  const { count } = await prisma.task.updateMany({
    where: { id: taskId, status: 'todo', workflowStatus: 'draft' },
    data: { status: 'blocked', updatedAt: new Date() },
  });
  if (count === 0) return false;
  await recordTransition({
    taskId,
    fromStatus: 'draft',
    toStatus: 'draft',
    actor: 'system',
    cause: BLOCKED_RETRY_HANDOFF_CAUSE,
    // workflowStatus stays draft (same as orphan_requeue_exhausted); only the task
    // status moved todo -> blocked, so that is carried in metadata.
    metadata: { reason, n, statusFrom: 'todo', statusTo: 'blocked' },
  }).catch(() => {});
  log.info({ taskId, n, reason }, '[blocked-retry-handoff] stranded draft -> blocked (escalation)');
  return true;
}
