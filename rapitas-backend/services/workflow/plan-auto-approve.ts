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
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';

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
 * @returns Resulting status + flag. / 結果ステータスとフラグ
 */
export async function maybeAutoApprovePlan(
  taskId: number,
  language: 'ja' | 'en' = 'ja',
  opts: { autoAdvance?: boolean } = {},
): Promise<PlanAutoApproveResult> {
  const userSettings = await prisma.userSettings.findFirst().catch(() => null);
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { autoApprovePlan: true, parentId: true, workflowStatus: true },
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

  const reason = taskLevel
    ? 'task-level autoApprovePlan setting enabled'
    : subtaskLevel
      ? 'subtask autoApproveSubtaskPlan setting enabled'
      : 'global autoApprovePlan setting enabled';

  await prisma.task
    .update({
      where: { id: taskId },
      data: { workflowStatus: 'plan_approved', updatedAt: new Date() },
    })
    .catch((err) => {
      log.warn({ err, taskId }, '[plan-auto-approve] Failed to flip status to plan_approved');
    });

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

  if (opts.autoAdvance !== false) {
    // 1s delay so the workflowStatus update commits before the orchestrator
    // queries it via role-resolver.
    setTimeout(async () => {
      try {
        const { WorkflowOrchestrator } = await import('./workflow-orchestrator');
        const result = await WorkflowOrchestrator.getInstance().advanceWorkflow(taskId, language);
        log.info(
          { taskId, success: result.success, error: result.error },
          '[plan-auto-approve] Auto-advance after auto-approval',
        );
      } catch (err) {
        log.error({ err, taskId }, '[plan-auto-approve] Auto-advance failed (non-fatal)');
      }
    }, 1000);
  }

  return { newStatus: 'plan_approved', autoApproved: true, reason };
}
