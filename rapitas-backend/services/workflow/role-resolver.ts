/**
 * role-resolver
 *
 * Single source of truth for "which agent should run task X right now?"
 * Mirrors the role-transition tables used by `workflow-orchestrator` so
 * every execution surface — the manual `/agents/execute` route, the bulk
 * approval handler, the orchestra runner — picks the same agent for the
 * same task at the same workflow step.
 *
 * Inputs:
 *   - task.workflowStatus   ("draft" | "research_done" | … | "completed")
 *   - task.workflowMode     ("lightweight" | "standard" | "comprehensive")
 *
 * Outputs:
 *   - the role name that owns the next step
 *   - the agentConfigId currently bound to that role in WorkflowRoleConfig
 *
 * Behaviour:
 *   - If the task has no workflow context, returns null and the caller
 *     should fall back to its existing default-agent logic.
 *   - If the role exists but is not assigned an agent, returns the role
 *     name with `agentConfigId: null` so the caller can decide whether
 *     to fail loudly or fall back.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recommendAgentForRole } from './role-recommender';
import { resolveTaskWorkflowState } from '../task/task-resolver';

const log = createLogger('role-resolver');

import { narrowWorkflowStatus, narrowWorkflowMode } from './workflow-types.guards.generated';
import type { WorkflowRole } from './workflow-types';
import { reconcileStatusFromExistingArtifacts } from './artifact-reuse-reconciler';

// NOTE: The status→role map is now derived from the DB-backed, UI-editable
// mode config (workflow-mode-config.ts) — the single source of truth shared
// with the orchestrator and the frontend. No more hardcoded per-mode table.

export interface ResolvedRoleAgent {
  role: WorkflowRole;
  agentConfigId: number | null;
  /**
   * Per-role model override. `null` means "no explicit override; use the
   * agent's default OR the SmartRouter auto-pick if 'auto'".
   * `'auto'` is a sentinel string used by the UI to mean "let the SmartRouter
   * pick the cheapest/best-fit model based on task complexity + budget".
   */
  modelId: string | null;
  /** True when modelId is null/'auto' — caller should invoke SmartRouter. */
  shouldAutoSelectModel: boolean;
}

/**
 * Pick the right agent for a task's current phase.
 *
 * @param taskId - Task ID. / タスクID
 * @returns Resolved role + agentConfigId, or null when the task has no
 *          workflow context (caller should use its own fallback). / 解決結果またはnull
 */
export async function resolveAgentForTask(taskId: number): Promise<ResolvedRoleAgent | null> {
  const task = await resolveTaskWorkflowState(taskId);
  if (!task) return null;

  let status = narrowWorkflowStatus(task.workflowStatus);
  // Terminal statuses have no next role.
  if (status === 'verify_done' || status === 'completed') return null;

  const mode = narrowWorkflowMode(task.workflowMode);
  const { getModeSettings, buildRoleByStatus } = await import('./workflow-mode-config');
  const modeSettings = await getModeSettings(mode);

  // Fast-forward past research/plan phases whose artifacts already exist and
  // are good enough to reuse — this is the SAME check runAdvanceWorkflow does
  // before dispatching, but this function is the SEPARATE path the manual
  // "実行" button (execute-route.ts) uses, which never goes through
  // runAdvanceWorkflow at all. Without this, clicking Execute on a
  // re-dispatched task with existing research.md/plan.md would still pick the
  // researcher role from the stale status instead of the actually-needed one.
  const reconciled = await reconcileStatusFromExistingArtifacts(
    taskId,
    status,
    modeSettings.includePlan,
  ).catch((err) => {
    log.warn({ err, taskId }, 'Artifact-reuse reconciliation failed');
    return { status, advanced: false };
  });
  status = reconciled.status;

  const role = buildRoleByStatus(modeSettings)[status];
  if (!role) {
    log.debug({ taskId, status, mode }, 'No role mapped for current workflow status');
    return null;
  }

  const roleConfig = await prisma.workflowRoleConfig.findUnique({
    where: { role },
    select: { agentConfigId: true, isEnabled: true, modelId: true },
  });
  // NOTE: We compute `shouldAutoSelectModel` based on the per-role modelId:
  //   - explicit modelId set ("claude-haiku-4-5-...") → use as-is
  //   - modelId === 'auto' or null/empty → SmartRouter picks
  const roleModelId = roleConfig?.modelId ?? null;
  const shouldAutoSelectModel = !roleModelId || roleModelId === 'auto' || roleModelId.trim() === '';

  if (roleConfig?.isEnabled && roleConfig.agentConfigId) {
    return {
      role,
      agentConfigId: roleConfig.agentConfigId,
      modelId: shouldAutoSelectModel ? null : roleModelId,
      shouldAutoSelectModel,
    };
  }

  // NOTE: Fall back to capability-based recommendation when no explicit
  // assignment exists. This ensures every role gets the BEST-FIT agent
  // available even when the user hasn't manually configured WorkflowRoleConfig.
  // codex (which ignores planning instructions) is automatically excluded
  // from researcher/planner/reviewer roles by the capability registry.
  log.info(
    { taskId, role, reason: roleConfig ? 'role disabled' : 'no role config' },
    'Falling back to capability-based agent recommendation',
  );
  const recommended = await recommendAgentForRole(role);
  if (!recommended) {
    return { role, agentConfigId: null, modelId: null, shouldAutoSelectModel: true };
  }
  log.info(
    {
      taskId,
      role,
      pickedAgent: recommended.agentName,
      pickedType: recommended.agentType,
      reason: recommended.reason,
    },
    'Auto-recommended agent for role',
  );
  // When recommender chose the agent, also flag for SmartRouter auto-select
  // unless the user explicitly pinned a model on the role.
  return {
    role,
    agentConfigId: recommended.agentConfigId,
    modelId: shouldAutoSelectModel ? null : roleModelId,
    shouldAutoSelectModel,
  };
}
