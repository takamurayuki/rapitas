/**
 * plan-auto-approve
 *
 * Single source of truth for "should the plan be auto-approved" — used by
 * BOTH the HTTP path (`PUT /workflow/tasks/:id/files/plan` → handleSaveFile)
 * AND the orchestrator path (`workflow-cli-executor` → writeWorkflowFile).
 *
 * Previously this logic lived only in the HTTP handler. When the planner
 * phase started saving plan.md via the orchestrator's direct
 * filesystem write (no HTTP round-trip), the auto-approve check was
 * silently skipped — leaving the task stuck at `plan_created` even when
 * the user had `userSettings.autoApprovePlan = true` configured.
 */
import { ExecutionCancelledError } from '../agents/execution-cancelled-error';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { getTaskExecutionCancellationVersion } from '../agents/task-execution-lock';
import { awaitCriticSettled, hasCritiqueInFlight } from './phase-critic/critic-inflight';
import {
  resolveForbiddenChangePlanHold,
  PLAN_FORBIDDEN_CHANGE_HOLD_CAUSE,
} from './forbidden-change-plan-hold';
import { isManualPlanApprovalHeld, notifyPlanHold } from './plan-auto-approve.policy';

export {
  isManualPlanApprovalHeld,
  resolveEffectiveAutoApprovePlan,
} from './plan-auto-approve.policy';

const log = createLogger('plan-auto-approve');

export interface PlanAutoApproveResult {
  /** Effective status after this helper runs. */
  newStatus: 'plan_created' | 'plan_approved';
  /** True when status was flipped from plan_created → plan_approved. */
  autoApproved: boolean;
  /** Reason recorded in the transition log when autoApproved=true. */
  reason?: string;
}

/**
 * Inspect the task / global settings and flip workflowStatus to
 * `plan_approved` when auto-approval is enabled. Idempotent: calling this
 * with a task that's already plan_approved is a no-op. Failures are
 * downgraded to WARN — auto-approve is a convenience, not a correctness
 * requirement.
 *
 * @param taskId - Task whose plan was just saved. / 計画保存対象タスク
 * @param language - Used by the auto-advance call. / 自動進行用の言語
 * @param opts.autoAdvance - When true (default), schedule the next
 *   workflow phase via WorkflowOrchestrator after a 1s delay. Pass false
 *   when the caller wants to drive advance themselves.
 * @param opts.onHeldApproval - Runs when an approval held for an in-flight
 *   critique is granted later, since the caller only saw autoApproved=false.
 *   / 保留後に承認されたときの後続処理
 * @returns Resulting status + flag. / 結果ステータスとフラグ
 */
export async function maybeAutoApprovePlan(
  taskId: number,
  language: 'ja' | 'en' = 'ja',
  opts: { autoAdvance?: boolean; onHeldApproval?: () => Promise<void> } = {},
): Promise<PlanAutoApproveResult> {
  const cancellationVersion = getTaskExecutionCancellationVersion(taskId);
  const userSettings = await prisma.userSettings.findFirst().catch(() => null);
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        autoApprovePlan: true,
        parentId: true,
        workflowStatus: true,
        status: true,
        updatedAt: true,
        themeId: true,
      },
    })
    .catch(() => null);

  // Already past plan_created — nothing to do.
  if (!task || task.workflowStatus !== 'plan_created') {
    return {
      newStatus: (task?.workflowStatus as 'plan_created' | 'plan_approved') ?? 'plan_created',
      autoApproved: false,
    };
  }

  const isSubtask = task.parentId !== null && task.parentId !== undefined;
  const settingsRecord = userSettings as Record<string, unknown> | null;
  const taskLevel = !!task.autoApprovePlan;
  const globalLevel = !!settingsRecord?.autoApprovePlan;
  const subtaskLevel = isSubtask && !!settingsRecord?.autoApproveSubtaskPlan;

  if (!taskLevel && !globalLevel && !subtaskLevel) {
    return { newStatus: 'plan_created', autoApproved: false };
  }
  if (await isManualPlanApprovalHeld(taskId)) {
    return { newStatus: 'plan_created', autoApproved: false };
  }
  // NOTE: The save handler stops waiting for the plan critique after 90s. Approving
  // while it still runs makes its late bounce miss the status check and be
  // discarded (task 1593). Every caller is held; one with follow-up work passes
  // onHeldApproval.
  if (hasCritiqueInFlight(taskId)) {
    log.info({ taskId }, '[plan-auto-approve] Plan critique in flight — holding auto-approval');
    void awaitCriticSettled(taskId)
      .then(async () => {
        if (getTaskExecutionCancellationVersion(taskId) !== cancellationVersion) return;
        const later = await maybeAutoApprovePlan(taskId, language, opts);
        if (later.autoApproved) await opts.onHeldApproval?.();
      })
      .catch((err) => {
        log.warn({ err, taskId }, '[plan-auto-approve] Held auto-approval failed');
      });
    return { newStatus: 'plan_created', autoApproved: false };
  }
  // Stop BEFORE the implementation is paid for (see forbidden-change-plan-hold).
  // Recorded as a transition so the history says why the task is waiting rather
  // than leaving a silent plan_created.
  const forbiddenHold = await resolveForbiddenChangePlanHold(taskId);
  if (forbiddenHold) {
    // Read BEFORE recording: a re-save/heal re-records the hold, and must not re-notify.
    const previous = await prisma.workflowTransition
      .findFirst({
        where: { taskId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { cause: true },
      })
      .catch(() => null);
    await recordTransition({
      taskId,
      fromStatus: 'plan_created',
      toStatus: 'plan_created',
      actor: 'system',
      cause: PLAN_FORBIDDEN_CHANGE_HOLD_CAUSE,
      phase: 'plan',
      metadata: { paths: forbiddenHold.paths, instruction: forbiddenHold.instruction },
    }).catch(() => {});
    log.warn(
      { taskId, paths: forbiddenHold.paths },
      '[plan-auto-approve] auto-approval withheld — plan needs a human forbidden-change override',
    );
    if (previous?.cause !== PLAN_FORBIDDEN_CHANGE_HOLD_CAUSE) {
      await notifyPlanHold(taskId, task.themeId ?? null, forbiddenHold.instruction);
    }
    return { newStatus: 'plan_created', autoApproved: false };
  }

  const reason = taskLevel
    ? 'task-level autoApprovePlan setting enabled'
    : subtaskLevel
      ? 'subtask autoApproveSubtaskPlan setting enabled'
      : 'global autoApprovePlan setting enabled';

  if (getTaskExecutionCancellationVersion(taskId) !== cancellationVersion) {
    return { newStatus: 'plan_created', autoApproved: false };
  }
  const approved = await prisma.task.updateMany({
    where: {
      id: taskId,
      workflowStatus: 'plan_created',
      status: 'in-progress',
      updatedAt: task.updatedAt,
    },
    data: { workflowStatus: 'plan_approved', updatedAt: new Date() },
  });
  if (approved.count !== 1) return { newStatus: 'plan_created', autoApproved: false };

  await recordTransition({
    taskId,
    fromStatus: 'plan_created',
    toStatus: 'plan_approved',
    actor: 'system',
    cause: 'auto_approve_plan',
    phase: 'plan',
    metadata: {
      taskLevelAutoApprove: taskLevel,
      globalAutoApprove: globalLevel,
      isSubtask,
      reason,
    },
  });

  // Decision journal: the auto-approval is a prediction too — recording it
  // with decidedBy:'auto' lets calibration stats compare the policy's accuracy
  // against human gate calls. Fire-and-forget.
  void import('../memory/decision-journal')
    .then(async ({ recordPlanDecision }) => {
      const t = await prisma.task
        .findUnique({ where: { id: taskId }, select: { title: true, themeId: true } })
        .catch(() => null);
      return recordPlanDecision({
        taskId,
        approved: true,
        decidedBy: 'auto',
        reason,
        taskTitle: t?.title ?? null,
        themeId: t?.themeId ?? null,
      });
    })
    .catch(() => {});

  await prisma.activityLog
    .create({
      data: {
        taskId,
        action: 'plan_auto_approved',
        metadata: JSON.stringify({
          previousStatus: 'plan_created',
          newStatus: 'plan_approved',
          reason,
          taskLevelSetting: taskLevel,
          globalLevelSetting: globalLevel,
          subtaskAutoApprove: subtaskLevel,
          isSubtask,
        }),
        createdAt: new Date(),
      },
    })
    .catch((err) => {
      log.warn({ err, taskId }, '[plan-auto-approve] Failed to write activity log');
    });

  log.info({ taskId, reason }, '[plan-auto-approve] Plan auto-approved');

  // Without this the queue item stays waiting_approval and the theme stays
  // paused_approval: no other path observes an automatic approval.
  try {
    const { syncAfterPlanApprovalAndNotifyTheme } = await import('./plan-approval-queue-sync');
    await syncAfterPlanApprovalAndNotifyTheme(taskId);
  } catch (err) {
    log.warn({ err, taskId }, '[plan-auto-approve] Queue sync after auto-approval failed');
  }

  if (opts.autoAdvance !== false) {
    // 1s delay so the workflowStatus update commits before the orchestrator
    // queries it via role-resolver.
    setTimeout(async () => {
      try {
        const { WorkflowOrchestrator } = await import('./workflow-orchestrator');
        if (getTaskExecutionCancellationVersion(taskId) !== cancellationVersion) {
          log.info({ taskId }, '[plan-auto-approve] Stop revoked the scheduled next phase');
          return;
        }
        if (await isManualPlanApprovalHeld(taskId)) return;
        if (getTaskExecutionCancellationVersion(taskId) !== cancellationVersion) return;
        const result = await WorkflowOrchestrator.getInstance().advanceWorkflow(taskId, language);
        log.info(
          { taskId, success: result.success, error: result.error },
          '[plan-auto-approve] Auto-advance after auto-approval',
        );
      } catch (err) {
        if (err instanceof ExecutionCancelledError) {
          log.info(
            { taskId, reason: err.message },
            '[plan-auto-approve] Auto-advance cancelled by stop',
          );
          return;
        }
        log.error({ err, taskId }, '[plan-auto-approve] Auto-advance failed (non-fatal)');
      }
    }, 1000);
  }

  return { newStatus: 'plan_approved', autoApproved: true, reason };
}
