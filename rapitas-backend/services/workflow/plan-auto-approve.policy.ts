/**
 * plan-auto-approve policy
 *
 * The read-only questions behind auto-approval (manual rejection hold, effective
 * setting) and the hold notice. Not responsible for flipping the task status
 * (plan-auto-approve.ts).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveForbiddenChangePlanHold } from './forbidden-change-plan-hold';

const log = createLogger('plan-auto-approve');

/**
 * Tells a human once that a plan is parked for a forbidden-change override. Stagnation
 * detection now treats a fresh hold as a deliberate wait (#1205), so this notice is
 * what keeps the wait visible. Never throws — a notify problem must not alter the hold.
 *
 * @param taskId - Held task. / 保留中のタスク
 * @param themeId - Task's theme, null when none. / テーマID
 * @param instruction - Operator instruction (override steps). / 運用者向け指示
 */
export async function notifyPlanHold(
  taskId: number,
  themeId: number | null,
  instruction: string,
): Promise<void> {
  try {
    const { notifyOnce, taskLabel } = await import('./auto-run/auto-run-notifications-shared');
    const label = await taskLabel(taskId);
    await notifyOnce({
      type: 'auto_run_awaiting_approval',
      themeId,
      taskId,
      title: '計画の承認待ち（人間の override が必要）',
      message: `「${label}」の計画は禁止変更を宣言しているため自動承認されません。${instruction}`,
    });
  } catch (err) {
    log.error({ err, taskId }, '[plan-auto-approve] plan-hold notification failed');
  }
}

/**
 * Read-only check: does a manual rejection currently hold auto-approve for
 * this task? A manual rejection remains a human gate until a later manual
 * approval. Does not mutate state.
 *
 * @param taskId - Task to check. / 対象タスク
 * @returns True while a manual rejection is in effect. / 却下保留中かどうか
 */
export async function isManualPlanApprovalHeld(taskId: number): Promise<boolean> {
  try {
    const decision = await prisma.workflowTransition.findFirst({
      where: { taskId, cause: { in: ['manual_plan_rejected', 'manual_plan_approved'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { cause: true },
    });
    return decision?.cause === 'manual_plan_rejected';
  } catch (err) {
    log.warn({ err, taskId }, '[plan-auto-approve] Cannot verify manual approval; holding');
    return true;
  }
}

/**
 * Resolves whether the plan WILL be auto-approved for this task: task-level flag
 * OR the global userSettings flag OR (for subtasks) the subtask flag — the SAME
 * condition maybeAutoApprovePlan uses to flip the status.
 *
 * NOTE: the agent prompt must branch on this EFFECTIVE value, not just the
 * task-level flag. Otherwise, with only the global setting enabled, the prompt
 * tells the agent to "stop and wait for approval" while the plan is silently
 * auto-approved — so the run ends at plan.md and never implements.
 *
 * @param taskId - Task whose plan policy is being resolved. / 対象タスク
 * @returns True when the plan will be auto-approved. / 自動承認されるか
 */
export async function resolveEffectiveAutoApprovePlan(taskId: number): Promise<boolean> {
  const [userSettings, task] = await Promise.all([
    prisma.userSettings.findFirst().catch(() => null),
    prisma.task
      .findUnique({ where: { id: taskId }, select: { autoApprovePlan: true, parentId: true } })
      .catch(() => null),
  ]);
  if (!task) return false;
  if (await isManualPlanApprovalHeld(taskId)) return false;
  // A plan that commits to a human-override-only change cannot be completed by
  // auto-approving it — the verify-time gate would refuse the result after the
  // whole implementation was paid for (task 1100: 41 files, task 1103: a full
  // implement+verify round). Hold here and let the human answer the same
  // question for the price of one planner run.
  const forbiddenHold = await resolveForbiddenChangePlanHold(taskId);
  if (forbiddenHold) return false;
  const isSubtask = task.parentId !== null && task.parentId !== undefined;
  const settings = userSettings as Record<string, unknown> | null;
  return (
    !!task.autoApprovePlan ||
    !!settings?.autoApprovePlan ||
    (isSubtask && !!settings?.autoApproveSubtaskPlan)
  );
}
