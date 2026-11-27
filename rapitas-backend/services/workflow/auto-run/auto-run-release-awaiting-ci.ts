/**
 * auto-run-release-awaiting-ci
 *
 * Scheduler-tick hand-back of a theme slot held by a task that only waits for CI / its required
 * merge (task 1568): the task's queue items are marked `completed` + `awaiting_ci` in ONE
 * transaction (awaiting-ci-release-txn.ts), the slot is released WITHOUT counting a finished task,
 * and the theme selects its next task. A lost race or failed write keeps the slot. Not
 * responsible for completing the task (AutoMergeWatcher) or repairing a red CI (ci-self-repair).
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { logCycleEvent } from '../../observability';
import { isTaskAwaitingCi } from '../awaiting-ci-lookup';
import { CI_WAIT_PHASE } from '../awaiting-ci';
import { handBackAwaitingCiItems } from './awaiting-ci-release-txn';
import { liveOrQueuedBehind } from './queue-wait-exemption';
import { releaseThemeSlot } from './parallel/theme-active-set';
import { broadcastAutoRunUpdateImpl } from './auto-run-lifecycle';
import { selectAndEnqueueNextTask } from './auto-run-advance-select';

const log = createLogger('theme-auto-run-scheduler');

/** Test seams: run code at the two points where ci-self-repair can interleave. */
export interface ReleaseAwaitingCiHooks {
  /** After the judgement and the item read, before the transaction. */
  afterRead?: () => Promise<void>;
  /** After the transaction committed, before the slot is released. */
  afterCommit?: () => Promise<void>;
}

/**
 * Hand the slot back when the current task waits for CI. Idempotent: a second tick (or a tick
 * after the runner already completed the item) finds nothing to update and `releaseThemeSlot`
 * answers `not_member`, which is not an error.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme being advanced / 進めるテーマID
 * @param taskId - Current (or companion) task / 対象タスクID
 * @param order - Task selection order / タスク選択順序
 * @param globalActive - Current global auto-run active count / グローバルアクティブ数
 * @param barrierHoldSince - Per-theme merge-barrier hold start / マージバリア保留開始時刻
 * @param hooks - Test seams for deterministic interleaving; unused in production / テスト用の注入点
 * @returns True when the task waits for CI and the tick is fully handled. / CI待ちとして処理したら true
 */
export async function releaseAwaitingCiSlot(
  prisma: PrismaClient,
  themeId: number,
  taskId: number,
  order: 'priority' | 'created',
  globalActive: number,
  barrierHoldSince: Map<number, number>,
  hooks: ReleaseAwaitingCiHooks = {},
): Promise<boolean> {
  // Positive evidence only: an unreadable task is never handed back.
  if (!(await isTaskAwaitingCi(taskId))) return false;
  // Items read BEFORE the transaction: a repair item queued afterwards is not ours to complete.
  let items: { id: number }[];
  try {
    items = await prisma.workflowQueueItem.findMany({
      where: { taskId, status: 'running', currentPhase: CI_WAIT_PHASE },
      select: { id: true },
    });
  } catch (err) {
    log.error({ err, taskId }, 'CI待ち項目の取得に失敗したため枠を保持します');
    return true;
  }
  // A live execution (e.g. a repair already running) must keep its slot. Quiet: this is the
  // normal answer for a CI wait, not an anomaly worth a WARN every tick.
  if (await liveOrQueuedBehind(prisma, taskId, { quiet: true, failClosed: true })) return true;

  // A runner that claimed its item (running, out of the CI-wait phase) or a queued repair owns the
  // task now: the hand-back's own CAS would find nothing, but freeing the slot would not be safe.
  const owner = await prisma.workflowQueueItem.findFirst({
    where: { taskId, status: { in: ['queued', 'running'] }, currentPhase: { not: CI_WAIT_PHASE } },
    select: { id: true },
  });
  if (owner) return true;

  await hooks.afterRead?.();

  let handedBack = 0;
  // No active item = already handed back earlier (a crash between commit and release) or never
  // had one: there is nothing to complete, only the slot to free.
  if (items.length > 0) {
    const res = await handBackAwaitingCiItems(
      prisma,
      taskId,
      items.map((i) => i.id),
    );
    if (res.result === 'lost') {
      log.info({ taskId }, 'CI待ちではなくなったため枠を保持します（次の tick で再評価）');
      return true;
    }
    if (res.result === 'failed') {
      log.warn({ err: res.error, taskId }, 'CI待ち項目の解放に失敗したため枠を保持します');
      return true;
    }
    handedBack = res.count;
    await hooks.afterCommit?.();
  }

  const outcome = await releaseThemeSlot(prisma, themeId, taskId, 'released');
  if (outcome === 'not_member') return true;
  log.info(
    `[ThemeAutoRunScheduler] Task ${taskId} waits for CI — slot released, items handed back: ${handedBack} (theme ${themeId})`,
  );
  logCycleEvent('task.skipped', {
    theme: themeId,
    task: taskId,
    cause: 'awaiting_ci_slot_released',
    msg: 'task waits for CI / merge — slot released so the theme can start the next task',
  });
  broadcastAutoRunUpdateImpl(themeId);
  await selectAndEnqueueNextTask(
    prisma,
    themeId,
    order,
    Math.max(0, globalActive - 1),
    barrierHoldSince,
  );
  return true;
}
