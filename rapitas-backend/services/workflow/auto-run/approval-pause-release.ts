/**
 * approval-pause-release
 *
 * One decision: an approval pause that NO automatic path can ever lift must
 * not keep holding the theme's concurrency slot. Decides when to release it,
 * and performs the release.
 *
 * Why this exists. `processPausedThemesImpl` has exactly two exits from
 * `paused_approval`: the plan becomes approved, or the queue item leaves
 * `waiting_approval` and a `queued` item reappears. Neither can ever fire for a
 * plan parked by `forbidden-change-plan-hold`, which deliberately keeps the
 * task at `plan_created` until a human overrides it — so the theme waits
 * forever. The paused path also never reads `Task.autoRunExcluded`, so an
 * operator who takes the task out of selection has no way to free the slot
 * either. `self-incident-watch-gates` meanwhile skips `paused_approval` on the
 * premise that "it is auto-resumed": both sides assume the other one covers
 * this, which is the same mistake as the `verify_done` hang-backstop exemption
 * fixed for task 1267.
 *
 * Measured on theme 1 (2026-10-15): task 1259 reached `plan_created` at
 * 00:47:46 with a `plan_forbidden_change_hold` for
 * `rapitas-backend/prisma/schema/workflow.prisma`. The theme sat at
 * `paused_approval` through a backend restart; `{action:'start'}` refreshed
 * `startedAt` but left `status` paused, and `PATCH /tasks/1259
 * {autoRunExcluded:true}` dropped `remainingCount` 7 -> 6 while still leaving
 * the theme pinned to 1259 seven minutes later. Four runnable bug/security
 * tasks (#1262, #1263, #1265, #1269) waited behind it.
 *
 * NOT responsible for approving or rejecting a plan, for notifying the human
 * (`plan-auto-approve` already sends `auto_run_awaiting_approval` when it
 * withholds approval), or for completing the task: the release leaves
 * `status`, `workflowStatus` and plan.md untouched so the ordinary selection
 * path resumes the task once a human overrides the hold.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { recordTransition } from '../transition-recorder';
import { logCycleEvent } from '../../observability';
import { isTaskPlanApproved } from '../plan-approval-queue-sync';
import { resolveForbiddenChangePlanHold } from '../forbidden-change-plan-hold';
import { isManualPlanApprovalHeld } from '../plan-auto-approve';
import { isAutoResumablePauseStatus, narrowAutoRunStatus } from './theme-auto-run-types';

const log = createLogger('workflow:approval-pause-release');

/** Transition cause recorded when an approval pause is released. */
export const APPROVAL_PAUSE_RELEASE_CAUSE = 'approval_pause_released';

/** Why the pause can never be lifted automatically. */
export type ApprovalPauseReleaseReason = 'operator_excluded' | 'forbidden_change_hold';

/** Everything the decision needs, so it stays pure and directly testable. */
export interface ApprovalPauseFacts {
  /** The theme's current auto-run status. / テーマの現在の自動実行ステータス */
  pauseStatus: string;
  /** Whether the current task's plan is already approved. / 計画が既に承認済みか */
  planApproved: boolean;
  /** Whether the operator took the task out of selection. / 運用者が選定除外したか */
  autoRunExcluded: boolean;
  /** Whether a human-only forbidden change holds the plan. / 禁止変更の人間承認待ちか */
  forbiddenChangeHeld: boolean;
  /** Whether a human rejected the plan. / 人間が計画を却下したか */
  manualRejectionHeld: boolean;
}

/** The release to perform, or null to keep waiting. */
export interface ApprovalPauseRelease {
  /** Which condition makes the wait unliftable. / 解放理由 */
  reason: ApprovalPauseReleaseReason;
  /**
   * Whether the release must also take the task out of selection.
   * Without it the selector re-picks the task and it re-pauses immediately —
   * the queue-spin failure mode seen on an untagged queue item.
   * / 解放と同時に選定除外を書く必要があるか
   */
  excludeFromAutoRun: boolean;
}

/**
 * Decide whether this approval pause may be released.
 *
 * @param facts - Observed state of the theme and its current task. / 観測した状態
 * @returns The release to perform, or null to keep waiting. / 解放内容、無ければ null
 */
export function decideApprovalPauseRelease(facts: ApprovalPauseFacts): ApprovalPauseRelease | null {
  // task 883: an explicit user pause and the reason-unknown legacy pause must
  // never be lifted by a polling safety net.
  if (!isAutoResumablePauseStatus(narrowAutoRunStatus(facts.pauseStatus))) return null;
  // The existing resume path owns an approved plan; releasing here would race it.
  if (facts.planApproved) return null;
  // The operator already said "do not select this task", so nothing will be
  // re-picked and there is nothing left to write.
  if (facts.autoRunExcluded) {
    return { reason: 'operator_excluded', excludeFromAutoRun: false };
  }
  // A rejected plan recovers through revise-plan, which re-dispatches the
  // planner — excluding it from selection would break that path.
  if (facts.manualRejectionHeld) return null;
  if (facts.forbiddenChangeHeld) {
    return { reason: 'forbidden_change_hold', excludeFromAutoRun: true };
  }
  return null;
}

/**
 * Gather the facts for a paused theme's current task.
 *
 * Fails CLOSED on a read error: the fields default to "no release", so a
 * transient database problem leaves the pause exactly as it was rather than
 * freeing a slot on missing information.
 *
 * @param taskId - The theme's current task. / テーマの現在タスク
 * @param pauseStatus - The theme's auto-run status. / テーマの自動実行ステータス
 * @param prisma - Prisma client. / Prismaクライアント
 * @returns Observed facts for the decision. / 判定用の観測結果
 */
export async function resolveApprovalPauseFacts(
  taskId: number,
  pauseStatus: string,
  prisma: PrismaClient,
): Promise<ApprovalPauseFacts> {
  const [planApproved, task, forbiddenHold, manualRejectionHeld] = await Promise.all([
    isTaskPlanApproved(taskId, prisma).catch(() => true),
    prisma.task
      .findUnique({ where: { id: taskId }, select: { autoRunExcluded: true } })
      .catch(() => null),
    resolveForbiddenChangePlanHold(taskId).catch(() => null),
    isManualPlanApprovalHeld(taskId).catch(() => true),
  ]);
  return {
    pauseStatus,
    planApproved,
    autoRunExcluded: !!task?.autoRunExcluded,
    forbiddenChangeHeld: !!forbiddenHold,
    manualRejectionHeld,
  };
}

/**
 * Release the slot: cancel the lingering approval-wait queue item, unpin the
 * task from the theme and set the theme running again.
 *
 * The theme update is a compare-and-set on `status` + `currentTaskId`, so a
 * theme that moved on between the decision and the write is left alone.
 *
 * @param themeId - Theme holding the pause. / 保留中のテーマ
 * @param taskId - Task the theme is pinned to. / 固定されているタスク
 * @param release - The decided release. / 決定した解放内容
 * @param prisma - Prisma client. / Prismaクライアント
 * @returns True when this call performed the release. / 実際に解放したか
 */
export async function releaseApprovalPause(
  themeId: number,
  taskId: number,
  release: ApprovalPauseRelease,
  prisma: PrismaClient,
): Promise<boolean> {
  if (release.excludeFromAutoRun) {
    // Written BEFORE the theme is freed: if the exclusion fails, the pause
    // stays and we retry next tick, rather than freeing a slot the selector
    // immediately spends on the same unapprovable task.
    const excluded = await prisma.task.updateMany({
      where: { id: taskId, autoRunExcluded: false },
      data: { autoRunExcluded: true },
    });
    if (excluded.count !== 1) {
      const current = await prisma.task
        .findUnique({ where: { id: taskId }, select: { autoRunExcluded: true } })
        .catch(() => null);
      if (!current?.autoRunExcluded) return false;
    }
  }

  const freed = await prisma.themeAutoRun.updateMany({
    where: { themeId, currentTaskId: taskId, status: { in: ['paused_approval'] } },
    data: { status: 'running', currentTaskId: null },
  });
  if (freed.count !== 1) return false;

  await prisma.workflowQueueItem
    .updateMany({
      where: { taskId, status: 'waiting_approval' },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: `Approval pause released: ${release.reason}`,
      },
    })
    .catch((err) => {
      // The slot is already free; a stale item only affects reporting, and the
      // stale-item sweep collects it.
      log.warn({ err, taskId }, '[approval-pause-release] queue item cancel failed');
    });

  await recordTransition({
    taskId,
    fromStatus: 'plan_created',
    toStatus: 'plan_created',
    actor: 'system',
    cause: APPROVAL_PAUSE_RELEASE_CAUSE,
    phase: 'plan',
    metadata: { themeId, reason: release.reason, excluded: release.excludeFromAutoRun },
  }).catch(() => {});

  logCycleEvent('theme.approval_pause_released', {
    theme: themeId,
    task: taskId,
    reason: release.reason,
  });
  log.info(
    { themeId, taskId, reason: release.reason },
    '[approval-pause-release] released the theme slot held by an unapprovable plan',
  );
  return true;
}
