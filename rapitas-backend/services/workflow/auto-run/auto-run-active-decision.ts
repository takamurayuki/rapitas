/**
 * auto-run-advance-active
 *
 * The current-task branch of the auto-run scheduler's advance step: CI-wait hand-back, hang
 * backstop (auto-run-tenure-guard.ts), active-item wait / stall release, and terminal resolution
 * (completed / failed / vanished item re-enqueue). On resolution it continues into next-task
 * selection (auto-run-advance-select). Extracted verbatim from ThemeAutoRunScheduler.advanceTheme
 * (task 628).
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { isTaskPlanApproved, syncQueueAfterPlanApproval } from '../plan-approval-queue-sync';

import { logCycleEvent } from '../../observability';
import { getThemeActiveQueueItems, hasItemAwaitingApproval } from './auto-run-selection';
import { onAwaitingPlanApproval } from './theme-auto-run-service';
import { loadThemeActiveSet } from './parallel/theme-active-set';
import { notifyCompanionAwaitingApprovalOnce } from './parallel/companion-approval-hold';
import { notifyAwaitingPlanApproval } from './auto-run-notifications';

import { releaseStaleActiveItems } from './auto-run-stall-guard';

import { broadcastAutoRunUpdateImpl } from './auto-run-lifecycle';
import { resolveCurrentTaskOutcome } from './auto-run-resolve-outcome';
import { releaseAwaitingCiSlot } from './auto-run-release-awaiting-ci';
import { applyTenureWall } from './auto-run-tenure-guard';

/**
 * Advance a running theme that has a current task: resolve the current task's
 * outcome (hang backstop / in-flight wait / terminal resolution) and, once it
 * is resolved, continue into next-task selection.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme to advance / 進めるテーマID
 * @param currentTaskId - Currently tracked task / 現在のタスクID
 * @param order - Task selection order / タスク選択順序
 * @param globalActive - Current global auto-run active count / グローバルアクティブ数
 * @param lastRunAt - When the current task became current / 現在タスクの開始時刻
 * @param barrierHoldSince - Per-theme merge-barrier hold start, forwarded to selection / マージバリア保留開始時刻
 */
export async function advanceActiveTaskLocked(
  prisma: PrismaClient,
  themeId: number,
  currentTaskId: number,
  order: 'priority' | 'created',
  globalActive: number,
  lastRunAt: string | null,
  barrierHoldSince: Map<number, number>,
): Promise<void> {
  // Task 1568: a task that only waits for CI / its required merge hands its slot back BEFORE any
  // tenure or in-flight wait below — those would read the 10-20 min wait as a hang or as work.
  if (
    await releaseAwaitingCiSlot(
      prisma,
      themeId,
      currentTaskId,
      order,
      globalActive,
      barrierHoldSince,
    )
  )
    return;

  if (
    await applyTenureWall(
      prisma,
      themeId,
      currentTaskId,
      order,
      globalActive,
      lastRunAt,
      barrierHoldSince,
    )
  )
    return;

  // Active queue items (queued / running / waiting_approval) for this task.
  const queueItems = await getThemeActiveQueueItems(prisma, themeId);
  const currentItems = queueItems.filter((i) => i.taskId === currentTaskId);

  // While the task still has an ACTIVE item it is in flight: never move on.
  // This is the core "one task fully completes before the next starts"
  // guarantee — the only non-terminal exit here is the approval pause.
  if (currentItems.length > 0) {
    // Task 618 (事例2): a TERMINAL task can still hold active items (e.g. a
    // 'running' residue after an abort). Waiting on those would wedge the
    // theme forever — release them and resolve the task in THIS tick.
    const releasedStaleCount = await releaseStaleActiveItems(
      prisma,
      themeId,
      currentTaskId,
      currentItems,
    );
    if (releasedStaleCount === 0) {
      // An approved plan can still own a waiting_approval item (in-flight agent
      // keeps it untouched); pausing again here would undo the resume each tick.
      const awaitingApproval = hasItemAwaitingApproval(currentItems);
      const approved = awaitingApproval && (await isTaskPlanApproved(currentTaskId, prisma));
      // Task 1552: with companions in the theme, an approval wait holds only
      // this task — pausing the theme would stop the others, and the pause's
      // release CAS assumes the head is the waiting task.
      const activeSet = awaitingApproval ? await loadThemeActiveSet(prisma, themeId) : null;
      // 承認照会中に解放された古い同伴がテーマ全体を止めない。
      if (
        activeSet?.readable &&
        activeSet.headTaskId !== currentTaskId &&
        !activeSet.companions.some((c) => c.taskId === currentTaskId)
      )
        return;
      const parallel = !!activeSet && activeSet.companions.length > 0;
      if (parallel && approved) {
        await syncQueueAfterPlanApproval(currentTaskId, prisma).catch(() => {});
      } else if (parallel) {
        await notifyCompanionAwaitingApprovalOnce(themeId, currentTaskId);
      } else if (awaitingApproval && !approved) {
        await onAwaitingPlanApproval(themeId);
        await notifyAwaitingPlanApproval(themeId, currentTaskId);
        broadcastAutoRunUpdateImpl(themeId);
        logCycleEvent('task.awaiting_approval', {
          theme: themeId,
          task: currentTaskId,
          cause: 'plan_approval_gate',
          msg: 'theme paused — plan awaiting approval',
        });
      }
      // queued / running → still working; wait for the next tick.
      return;
    }
    // released > 0: the items were residue of an already-terminal task.
    // Fall through to the terminal resolution below in the same tick.
  }

  await resolveCurrentTaskOutcome(
    prisma,
    themeId,
    currentTaskId,
    order,
    globalActive,
    barrierHoldSince,
  );
}
