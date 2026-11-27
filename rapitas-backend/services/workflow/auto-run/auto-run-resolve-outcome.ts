/**
 * auto-run-resolve-outcome
 *
 * Terminal resolution of a theme's current task once it has no in-flight queue
 * item: completed / failed / cancelled / vanished-item outcomes, ending in
 * either next-task selection or a bounded re-enqueue. Extracted verbatim from
 * auto-run-active-decision.ts to stay under the file-size ratchet (task 1009).
 * Not responsible for the hang backstop or in-flight waiting.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { writeBlockedTask } from '../blocked-task-write';
import { resolveTaskWorkflowState } from '../../task/task-resolver';
import { WorkflowQueueService } from '../workflow-queue';
import { logCycleEvent } from '../../observability';
import { COOLDOWN_MS, isAwaitingUserAnswer } from './auto-run-selection';
import { liveOrQueuedBehind } from './queue-wait-exemption';
import { requeueIfNeverExecuted } from './requeue-if-never-executed';
// Task 1552: every slot write goes through the running set so a theme running
// companions frees only this task's slot; alone, these are the same calls as
// setCurrentTask / onTaskCompleted / onTaskFailed.
import { releaseThemeSlot, retrackThemeSlot } from './parallel/theme-active-set';
import {
  notifyAwaitingUserAnswer,
  notifyTaskSkipped,
  notifyTaskVanished,
} from './auto-run-notifications';
import { isTaskVanishedMessage } from '../queue-vanished-task-policy';
import { isCancelledCurrent, releaseCancelledCurrent } from './auto-run-terminal-current';
import { broadcastAutoRunUpdateImpl } from './auto-run-lifecycle';
import { selectAndEnqueueNextTask } from './auto-run-advance-select';
import { userActedAfter } from './auto-run-recovery-history';
import { resumeOrReleaseVanishedItem } from './auto-run-resolve-reenqueue';
import { isAwaitingCiItem } from '../awaiting-ci';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Resolve the current task's outcome and continue into selection / re-enqueue.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme being advanced / 進めるテーマID
 * @param currentTaskId - Currently tracked task / 現在のタスクID
 * @param order - Task selection order / タスク選択順序
 * @param globalActive - Current global auto-run active count / グローバルアクティブ数
 * @param barrierHoldSince - Per-theme merge-barrier hold start / マージバリア保留開始時刻
 */
export async function resolveCurrentTaskOutcome(
  prisma: PrismaClient,
  themeId: number,
  currentTaskId: number,
  order: 'priority' | 'created',
  globalActive: number,
  barrierHoldSince: Map<number, number>,
): Promise<void> {
  // No active item. Decide the outcome from the most recent TERMINAL queue
  // item FIRST, then fall back to task.status. Checking the terminal item
  // unconditionally (not only when an active item exists) fixes the stall
  // where a queue item failed after max retries but task.status was left
  // 'in-progress' (WorkflowRunner only sets task.status for subtasks) — the
  // theme used to hang here until the 45-min wall backstop.
  const terminalItem = await prisma.workflowQueueItem.findFirst({
    where: {
      themeId,
      taskId: currentTaskId,
      status: { in: ['completed', 'failed', 'cancelled'] },
    },
    orderBy: { completedAt: 'desc' },
    select: { id: true, status: true, currentPhase: true, errorMessage: true, completedAt: true },
  });

  const task = await resolveTaskWorkflowState(currentTaskId);

  // A question can be saved while the task is still in-progress, after its
  // queue item disappears. Waiting is a workflow state, not only task.blocked.
  if (
    task?.workflowStatus === 'awaiting_question' &&
    ['todo', 'in-progress', 'blocked'].includes(task.status)
  ) {
    await notifyAwaitingUserAnswer(themeId, currentTaskId);
    // Preserve the unanswered task, but release the theme slot so unrelated
    // eligible tasks can run on the next tick. Never stop/revert the task here.
    if (!(await liveOrQueuedBehind(prisma, currentTaskId))) {
      await releaseThemeSlot(prisma, themeId, currentTaskId, 'released');
      broadcastAutoRunUpdateImpl(themeId);
    }
    return;
  }

  // Task 1568: the runner handed this task's item back for a CI wait (`awaiting_ci`) and the task
  // is not finished. Its slot is freed WITHOUT counting a completed task, and the stale item must
  // not stand in for the task's completion — that also covers the window where ci-self-repair has
  // already moved the task out of verify_done but has not queued its repair item yet. Never
  // re-enqueue it below: that would take the slot straight back.
  if (isAwaitingCiItem(terminalItem) && task?.status === 'in-progress') {
    await releaseThemeSlot(prisma, themeId, currentTaskId, 'released');
    broadcastAutoRunUpdateImpl(themeId);
    logCycleEvent('task.skipped', {
      theme: themeId,
      task: currentTaskId,
      cause: 'awaiting_ci_slot_released',
      msg: 'task waits for CI / merge — slot released so the theme can start the next task',
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

  // Confirmed-vanished-task guard (task 651): the task row is confirmed
  // absent (dequeue/runner/reconciler all detected this and marked their
  // queue item with the same vanished-task marker). Writing task.blocked
  // for a task that doesn't exist is meaningless — record task.skipped with
  // a distinct cause and move straight to the next task, never through the
  // isFailed branch below (which would try `prisma.task.update` against a
  // non-existent row and silently no-op, and whose 'blocked' framing is
  // inaccurate for "this task no longer exists").
  if (terminalItem && isTaskVanishedMessage(terminalItem.errorMessage) && !task) {
    await notifyTaskVanished(themeId, currentTaskId);
    broadcastAutoRunUpdateImpl(themeId);
    logCycleEvent('task.skipped', {
      theme: themeId,
      task: currentTaskId,
      cause: 'task_vanished',
      msg: 'task row confirmed absent — skipped without blocking',
    });
    await new Promise((r) => setTimeout(r, COOLDOWN_MS));
    await selectAndEnqueueNextTask(
      prisma,
      themeId,
      order,
      Math.max(0, globalActive - 1),
      barrierHoldSince,
    );
    return;
  }

  // Cancelled current task (task 1009): release the slot and select the next
  // task instead of falling into the re-enqueue branch below.
  if (isCancelledCurrent(task) && terminalItem?.status !== 'completed') {
    await releaseCancelledCurrent(prisma, themeId, currentTaskId);
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

  const isCompleted =
    terminalItem?.status === 'completed' ||
    task?.status === 'done' ||
    task?.workflowStatus === 'completed';
  // NOTE: 'cancelled' is deliberately NOT a failure. An item is cancelled when
  // the dispatch was ABANDONED — auto-run stopped, the task reached a terminal
  // state, a phantom item was swept, or the task was not runnable at dispatch
  // time (queue-skip-policy). None of those mean the TASK failed, and treating
  // them as failure is what blocked task 646 ten seconds after its user
  // answered the question.
  const isFailed =
    terminalItem?.status === 'failed' || task?.status === 'failed' || task?.status === 'blocked';

  if (isCompleted) {
    await releaseThemeSlot(prisma, themeId, currentTaskId, 'completed');
    broadcastAutoRunUpdateImpl(themeId);
    logCycleEvent('task.completed', {
      theme: themeId,
      task: currentTaskId,
      ok: true,
      via: terminalItem?.status === 'completed' ? 'queue_item' : 'task_status',
      msg: 'task completed — advancing to next',
    });
    await new Promise((r) => setTimeout(r, COOLDOWN_MS));
    await selectAndEnqueueNextTask(
      prisma,
      themeId,
      order,
      Math.max(0, globalActive - 1),
      barrierHoldSince,
    );
    return;
  }

  if (isFailed) {
    // A task parked as 'blocked' may actually be WAITING FOR A USER ANSWER
    // (AskUserQuestion), not failed. Hold the theme here: advancing would
    // start the next task's agent, which then runs concurrently with this
    // task's answer-resume — the "multiple agents launched" symptom.
    if (task?.status === 'blocked' && (await isAwaitingUserAnswer(prisma, currentTaskId))) {
      log.info(
        `[ThemeAutoRunScheduler] Task ${currentTaskId} is awaiting a user answer — holding, not advancing (theme ${themeId})`,
      );
      await notifyAwaitingUserAnswer(themeId, currentTaskId);
      broadcastAutoRunUpdateImpl(themeId);
      logCycleEvent('task.awaiting_answer', {
        theme: themeId,
        task: currentTaskId,
        cause: 'ask_user_question',
        msg: 'theme holding — task awaiting user answer',
      });
      return;
    }
    // A HUMAN may have acted on this task after the queue item reached its
    // terminal state — answering a question revives it (workflowStatus → draft,
    // status → todo). `task` above is a snapshot taken before the
    // awaiting-answer lookup and the notifications, so writing 'blocked' from
    // it silently undoes that answer: measured 2026-08-24 on task 646, where the
    // answer landed 10 seconds before this write.
    // Only a `user` actor counts — system transitions are the very failure being
    // resolved here and must not veto their own bookkeeping.
    if (await userActedAfter(prisma, currentTaskId, terminalItem?.completedAt ?? null)) {
      log.info(
        `[ThemeAutoRunScheduler] Task ${currentTaskId} was revived by the user — re-queuing instead of blocking (theme ${themeId})`,
      );
      logCycleEvent('task.revived', {
        theme: themeId,
        task: currentTaskId,
        cause: 'user_action_after_failure',
        msg: 'user acted after the failure decision — re-queued instead of blocked',
      });
      await WorkflowQueueService.getInstance()
        .enqueue({ taskId: currentTaskId, themeId, priority: 50 })
        .catch(() => {});
      await retrackThemeSlot(prisma, themeId, currentTaskId);
      broadcastAutoRunUpdateImpl(themeId);
      return;
    }

    const errMsg = terminalItem?.errorMessage ?? `Task ${currentTaskId} failed or was blocked`;
    // Mark the task blocked so selection skips it next time.
    if (task?.status !== 'blocked') {
      // Task 1007: same last-chance guard as the wall-budget branch — a task that
      // never executed failed in the queue, not in the agent. Requeue it (bounded)
      // and skip the failure notices; an already-blocked task is never reopened.
      if (await requeueIfNeverExecuted(prisma, currentTaskId, themeId)) {
        log.warn(
          `[ThemeAutoRunScheduler] Task ${currentTaskId} failed in the queue without ever executing — requeued instead of blocked (theme ${themeId})`,
        );
        logCycleEvent('task.skipped', {
          theme: themeId,
          task: currentTaskId,
          cause: 'terminal_failure_never_executed',
          msg: 'never-executed task requeued instead of blocked after a terminal queue failure',
        });
        await retrackThemeSlot(prisma, themeId, currentTaskId);
        broadcastAutoRunUpdateImpl(themeId);
        return;
      }
      await writeBlockedTask(prisma, currentTaskId).catch(() => {});
    }
    await releaseThemeSlot(prisma, themeId, currentTaskId, 'failed', errMsg);
    await notifyTaskSkipped(themeId, currentTaskId, errMsg);
    broadcastAutoRunUpdateImpl(themeId);
    logCycleEvent('task.blocked', {
      theme: themeId,
      task: currentTaskId,
      ok: false,
      cause: terminalItem?.status ?? 'blocked',
      msg: errMsg.slice(0, 200),
    });
    await new Promise((r) => setTimeout(r, COOLDOWN_MS));
    await selectAndEnqueueNextTask(
      prisma,
      themeId,
      order,
      Math.max(0, globalActive - 1),
      barrierHoldSince,
    );
    return;
  }

  await resumeOrReleaseVanishedItem(
    prisma,
    themeId,
    currentTaskId,
    order,
    globalActive,
    barrierHoldSince,
  );
}
