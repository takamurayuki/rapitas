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
   * Per-role model override, or null when the SmartRouter should pick.
   * `'auto'` is the UI sentinel for that; an unset/empty value means the same
   * (see shouldAutoSelectModel in role-route-inputs).
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

  // NOTE: Manual per-role agent and model pins are no longer read
  // (2026-11-20). The agent comes from the recommender over the agent configs
  // synced to the usable providers, and SmartRouter always picks the model
  // from the tier table. Stale pins had kept phases off the table.
  // codex (which ignores planning instructions) is automatically excluded
  // from researcher/planner roles by the capability registry.
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
  return {
    role,
    agentConfigId: recommended.agentConfigId,
    modelId: null,
    shouldAutoSelectModel: true,
  };
}
