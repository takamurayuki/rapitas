/**
 * execution/dev-mode-planning-advance
 *
 * Auto-advances a dev-mode run that stopped after a planning phase
 * (research_done / plan_approved) inside a managed workflow mode.
 * Separated from execute-post-handler.ts to keep each file under 500 lines.
 */

import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';

const log = createLogger('routes:agent-execution:dev-mode-planning-advance');

/** Dev-mode statuses with a NEXT agent phase. `plan_created` is excluded — it
 *  is awaiting approval, not stalled; `in_progress`/terminal are left to the
 *  normal commit pipeline. */
const DEV_ADVANCEABLE_STATUSES = new Set(['research_done', 'plan_approved']);

/**
 * Auto-advance a dev-mode run that stopped after a planning phase.
 *
 * A plain `development`-mode agent run (not a `workflow-*` orchestrator phase)
 * self-follows CLAUDE.md: it saves research.md / plan.md and then STOPS (the
 * agent is told to wait for approval before implementing). Nothing then
 * scheduled the implementer, so the task stalled at `plan_approved` with no
 * further activity. When the task is in a managed workflow mode and parked at
 * such a status, kick the orchestrator so the next phase (planner / implementer)
 * runs. Planning produced no code diff, so the caller skips the commit pipeline.
 *
 * @param taskId - Task to inspect/advance. / 対象タスクID
 * @returns true when an advance was scheduled (caller should skip commit). / 進行を予約したか
 */
export async function advanceManagedPlanningPhase(taskId: number): Promise<boolean> {
  const managed = await prisma.task
    .findUnique({ where: { id: taskId }, select: { workflowMode: true, workflowStatus: true } })
    .catch(() => null);
  const isManagedMode =
    managed?.workflowMode === 'comprehensive' ||
    managed?.workflowMode === 'standard' ||
    managed?.workflowMode === 'lightweight';
  if (!isManagedMode || !managed?.workflowStatus) return false;
  if (!DEV_ADVANCEABLE_STATUSES.has(managed.workflowStatus)) return false;

  log.info(
    { taskId, workflowStatus: managed.workflowStatus, mode: managed.workflowMode },
    '[API] Dev-mode run stopped after a planning phase — auto-advancing workflow to the next phase',
  );
  // 1s delay so the status writes above commit before the next phase reads them.
  setTimeout(() => {
    import('../../../../services/workflow/workflow-orchestrator')
      .then(({ WorkflowOrchestrator }) =>
        WorkflowOrchestrator.getInstance().advanceWorkflow(taskId, 'ja'),
      )
      .catch((advanceErr) =>
        log.error(
          { err: advanceErr, taskId },
          '[API] Auto-advance after dev-mode planning phase failed (user can re-run manually)',
        ),
      );
  }, 1000);
  return true;
}
