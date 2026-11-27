/**
 * auto-run-resolve-reenqueue
 *
 * The last branch of the theme's current-task resolution: the task has NO active and NO terminal
 * queue item and is not terminal, so its item vanished mid-workflow. Re-enqueue it (bounded), or
 * release the slot when it is held out of auto-run, cancelled, or keeps being cancelled. Split
 * out of auto-run-resolve-outcome.ts (file-size limit); behaviour unchanged.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { resolveTaskWorkflowState } from '../../task/task-resolver';
import { WorkflowQueueService } from '../workflow-queue';
import { readAutoRunHold } from './auto-run-hold-check';
import { logCycleEvent } from '../../observability';
import { releaseThemeSlot, retrackThemeSlot } from './parallel/theme-active-set';
import { isTaskTerminalForQueue } from '../queue-terminal-task-guard';
import { isCancelledCurrent, releaseCancelledCurrent } from './auto-run-terminal-current';
import { broadcastAutoRunUpdateImpl } from './auto-run-lifecycle';
import { selectAndEnqueueNextTask } from './auto-run-advance-select';
import { readTaskAwaitingCi } from '../awaiting-ci-lookup';
import { hasRunawayCancelLoop } from './auto-run-recovery-history';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Resume a task whose queue item vanished, or release its slot.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme being advanced / 進めるテーマID
 * @param currentTaskId - Currently tracked task / 現在のタスクID
 * @param order - Task selection order / タスク選択順序
 * @param globalActive - Current global auto-run active count / グローバルアクティブ数
 * @param barrierHoldSince - Per-theme merge-barrier hold start / マージバリア保留開始時刻
 */
export async function resumeOrReleaseVanishedItem(
  prisma: PrismaClient,
  themeId: number,
  currentTaskId: number,
  order: 'priority' | 'created',
  globalActive: number,
  barrierHoldSince: Map<number, number>,
): Promise<void> {
  // No active AND no terminal queue item, and the task is not terminal:
  // the item vanished (e.g. cleared) while the task is still mid-workflow.
  // Re-enqueue the SAME task so it resumes — never silently stall. The
  // WorkflowRunner picks up from the task's current workflowStatus.
  //
  // Bounded, though: if the same task keeps coming straight back as a cancelled
  // item, re-enqueueing spins. Measured 2026-08-24 on task 635 (todo +
  // awaiting_question, which the orchestrator refuses to dispatch): 106 queue
  // items in 21 minutes while auto-run reported itself as running. The selector
  // no longer picks that state, but any future "enqueued then immediately
  // abandoned" cause would loop the same way, so release the task instead.
  if (await hasRunawayCancelLoop(prisma, currentTaskId)) {
    log.warn(
      `[ThemeAutoRunScheduler] Task ${currentTaskId} keeps being cancelled without running — releasing it (theme ${themeId})`,
    );
    logCycleEvent('task.skipped', {
      theme: themeId,
      task: currentTaskId,
      cause: 'runaway_cancel_loop',
      msg: 'enqueue-cancel loop detected — task released so the theme can move on',
    });
    await releaseThemeSlot(prisma, themeId, currentTaskId, 'released');
    broadcastAutoRunUpdateImpl(themeId);
    return;
  }

  // Re-check right before re-enqueueing: the task may have turned terminal since the
  // snapshot above. Never log "re-enqueued" for a terminal task (task 1009).
  const latest = await resolveTaskWorkflowState(currentTaskId);
  if (isTaskTerminalForQueue(latest)) {
    if (isCancelledCurrent(latest)) {
      await releaseCancelledCurrent(prisma, themeId, currentTaskId);
    } else {
      await releaseThemeSlot(prisma, themeId, currentTaskId, 'completed'); // done/completed: same bookkeeping as isCompleted above
      logCycleEvent('task.completed', {
        theme: themeId,
        task: currentTaskId,
        ok: true,
        via: 'task_status_recheck',
        msg: 'task completed before re-enqueue — advancing to next',
      });
    }
    broadcastAutoRunUpdateImpl(themeId);
    await selectAndEnqueueNextTask(
      prisma,
      themeId,
      order,
      Math.max(0, globalActive - 1),
      barrierHoldSince,
    );
    return;
  }

  // A task the operator parked must not be resumed. The selection side already
  // refuses one (eligibleTopLevelTodoWhere), but this resume branch did not,
  // so a hold stopped nothing: measured 2026-10-13, setting autoRunExcluded on
  // #1214 was followed within seconds by a fresh queue item and a $8.86
  // execution, and cancelling that item produced another. Release the theme's
  // current task and move on, exactly as the runaway-cancel-loop branch above
  // does — leaving currentTaskId pointing at a held task would retry every
  // tick forever.
  const hold = await readAutoRunHold(prisma, currentTaskId);
  if (hold.held) {
    log.warn(
      `[ThemeAutoRunScheduler] Task ${currentTaskId} is held out of auto-run (${hold.reason}) — not resuming it (theme ${themeId})`,
    );
    logCycleEvent('task.skipped', {
      theme: themeId,
      task: currentTaskId,
      cause: `held_${hold.reason}`,
      msg: 'task is held out of auto-run — released so the theme can move on',
    });
    await releaseThemeSlot(prisma, themeId, currentTaskId, 'released');
    broadcastAutoRunUpdateImpl(themeId);
    await selectAndEnqueueNextTask(
      prisma,
      themeId,
      order,
      Math.max(0, globalActive - 1),
      barrierHoldSince,
    );
    return;
  }

  // Task 1568: a CI-waiting task is not a vanished item even when no handed-back item is on file
  // (the item row was cleared): re-enqueueing it would take the slot straight back.
  let waitsForCi: boolean;
  try {
    waitsForCi = await readTaskAwaitingCi(currentTaskId);
  } catch (err) {
    // Unknown is not "safe to resume": a second runner could complete or re-run a CI-waiting task.
    log.warn(
      { err, taskId: currentTaskId },
      'CI待ちを確認できないため再投入を次の tick に見送ります',
    );
    return;
  }
  if (waitsForCi) {
    await releaseThemeSlot(prisma, themeId, currentTaskId, 'released');
    broadcastAutoRunUpdateImpl(themeId);
    logCycleEvent('task.skipped', {
      theme: themeId,
      task: currentTaskId,
      cause: 'awaiting_ci_slot_released',
      msg: 'task waits for CI / merge — slot released instead of re-enqueueing it',
    });
    await selectAndEnqueueNextTask(
      prisma,
      themeId,
      order,
      Math.max(0, globalActive - 1),
      barrierHoldSince,
    );
    return;
  }

  try {
    // NOTE: getInstance() replaces the former scheduler `queue` field — same singleton (task 628).
    await WorkflowQueueService.getInstance().enqueue({
      taskId: currentTaskId,
      themeId,
      priority: 50,
    });
    await retrackThemeSlot(prisma, themeId, currentTaskId);
    broadcastAutoRunUpdateImpl(themeId);
    log.warn(
      `[ThemeAutoRunScheduler] Task ${currentTaskId} had no queue item; re-enqueued to resume (theme ${themeId})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 'already in the queue' means a race re-created it — fine, just wait.
    if (!msg.includes('already in the queue')) {
      log.error({ err }, `[ThemeAutoRunScheduler] Failed to re-enqueue task ${currentTaskId}`);
    }
  }
  return;
}
