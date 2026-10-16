/**
 * WorkflowOrchestratorCalendarGuard
 *
 * Phase-boundary half of the calendar-aware auto-run gate (task 1174, AC3/AC4).
 * Every phase advance passes through WorkflowOrchestrator.advanceWorkflow, so
 * holding here stops a task that is ALREADY running at its next checkpoint (a
 * phase boundary whose artifact is persisted as a WorkflowFile row) from
 * `start - leadMinutes` until the meeting ends. The running phase itself is
 * never interrupted. While held, the guard returns `skipped + held`; the
 * WorkflowRunner re-queues the item and re-dispatches it every poll, so once
 * the meeting is over the next phase starts from the saved workflowStatus.
 * Selection-time holding of NEW tasks stays in auto-run-advance-gates.ts.
 */
import { createLogger } from '../../config/logger';
import { logCycleEvent } from '../observability';
import {
  clearTaskCalendarHold,
  isTaskCalendarHeld,
  markTaskCalendarHold,
} from '../scheduling/calendar-slot/calendar-hold-state';
import { decideCalendarHold } from '../scheduling/calendar-slot/calendar-hold-decision';
import type { WorkflowAdvanceResult } from './workflow-agent-executor';
import type { RoleTransition, WorkflowStatus } from './workflow-types';

const log = createLogger('workflow:calendar-guard');

/** Collaborators, injectable for tests. Defaults resolve lazily (no static DB import). */
export interface CalendarGuardDeps {
  now: () => Date;
  /**
   * Whether the task is being driven by the queue runner (a 'running' queue
   * item exists). Only then does a skipped result get re-queued and resumed;
   * a manual, runner-less advance would be stranded, so it is not held.
   */
  runnerOwned: (taskId: number) => Promise<boolean>;
  recordActivity: (action: string, metadata: Record<string, unknown>) => Promise<void>;
}

const defaultDeps: CalendarGuardDeps = {
  now: () => new Date(),
  runnerOwned: async (taskId) => {
    const { prisma } = await import('../../config');
    const item = await prisma.workflowQueueItem.findFirst({
      where: { taskId, status: 'running' },
      select: { id: true },
    });
    return item != null;
  },
  recordActivity: async (action, metadata) => {
    const { recordCalendarActivity } = await import('../scheduling/calendar-slot/calendar-store');
    await recordCalendarActivity(action, metadata);
  },
};

export type CalendarGuardOutcome = { done: true; result: WorkflowAdvanceResult } | { done: false };

/**
 * Stop at the phase boundary while a meeting is within the lead window or in
 * progress. Fails open (continues) when the gate is off, the calendar data is
 * unusable, the advance is not runner-owned, or any lookup throws.
 *
 * @param taskId - Task about to start its next phase / 次フェーズに入るタスク
 * @param transition - Resolved role transition / 現ステータスの遷移
 * @param currentStatus - Saved checkpoint (workflowStatus) / 保存済みのチェックポイント
 * @param deps - Test overrides / テスト用差し替え
 * @returns Early-return result while held, else continue / 保留中は早期終了結果
 */
export async function guardCalendarPhaseBoundary(
  taskId: number,
  transition: RoleTransition,
  currentStatus: WorkflowStatus,
  deps: Partial<CalendarGuardDeps> = {},
): Promise<CalendarGuardOutcome> {
  const d: CalendarGuardDeps = { ...defaultDeps, ...deps };
  const now = d.now();
  const { usable, gate } = await decideCalendarHold(now);
  if (!gate.hold) {
    if (clearTaskCalendarHold(taskId)) {
      const cause = usable ? gate.reason : 'calendar_unavailable';
      logCycleEvent('task.calendar_phase_released', {
        task: taskId,
        cause,
        phase: currentStatus,
        msg: 'calendar hold lifted — resuming from the saved phase checkpoint',
      });
      await d
        .recordActivity('calendar_slot.phase_released', {
          taskId,
          checkpoint: currentStatus,
          cause,
        })
        .catch((err) => log.warn({ err, taskId }, '[calendar-guard] failed to record release'));
    }
    return { done: false };
  }
  try {
    if (!(await d.runnerOwned(taskId))) return { done: false };
  } catch (err) {
    log.warn({ err, taskId }, '[calendar-guard] runner lookup failed — proceeding (fail open)');
    return { done: false };
  }
  const releaseAt = gate.releaseAt?.toISOString() ?? null;
  if (!isTaskCalendarHeld(taskId, now)) {
    logCycleEvent('task.calendar_phase_hold', {
      task: taskId,
      cause: gate.reason,
      phase: currentStatus,
      releaseAt,
      msg: 'calendar hold — stopped at the phase boundary until the meeting ends',
    });
    await d
      .recordActivity('calendar_slot.phase_held', {
        taskId,
        role: transition.role,
        checkpoint: currentStatus,
        reason: gate.reason,
        releaseAt,
      })
      .catch((err) => log.warn({ err, taskId }, '[calendar-guard] failed to record hold'));
  }
  markTaskCalendarHold(taskId, gate.releaseAt);
  return {
    done: true,
    result: {
      success: true,
      role: transition.role,
      status: currentStatus,
      skipped: true,
      held: `calendar busy until ${releaseAt ?? 'unknown'}`,
    },
  };
}
