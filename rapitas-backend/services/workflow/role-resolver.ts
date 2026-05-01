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

const log = createLogger('role-resolver');

type WorkflowRole =
  | 'researcher'
  | 'planner'
  | 'reviewer'
  | 'implementer'
  | 'verifier'
  | 'auto_verifier';

type WorkflowStatus =
  | 'draft'
  | 'research_done'
  | 'plan_created'
  | 'plan_approved'
  | 'in_progress'
  | 'verify_done'
  | 'completed';

type WorkflowMode = 'lightweight' | 'standard' | 'comprehensive';

/**
 * Role that owns each workflow status, per workflow mode.
 *
 * NOTE: Research is mandatory across ALL modes — the read-only research
 * pipeline (codex with --sandbox=read-only, stdout → research.md) runs
 * regardless of complexity. lightweight skips plan/review; standard adds
 * them back. This mirrors the frontend's getWorkflowTabs / getStatusToNextRole.
 */
const ROLE_BY_STATUS: Record<WorkflowMode, Partial<Record<WorkflowStatus, WorkflowRole>>> = {
  comprehensive: {
    draft: 'researcher',
    research_done: 'planner',
    plan_created: 'reviewer',
    plan_approved: 'implementer',
    in_progress: 'verifier',
  },
  standard: {
    draft: 'researcher',
    research_done: 'planner',
    plan_created: 'reviewer',
    plan_approved: 'implementer',
    in_progress: 'verifier',
  },
  lightweight: {
    draft: 'researcher',
    research_done: 'implementer',
    in_progress: 'auto_verifier',
  },
};

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
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { workflowStatus: true, workflowMode: true },
  });
  if (!task) return null;

  const status = (task.workflowStatus as WorkflowStatus | null) ?? 'draft';
  // Terminal statuses have no next role.
  if (status === 'verify_done' || status === 'completed') return null;

  const mode: WorkflowMode = (task.workflowMode as WorkflowMode | null) ?? 'comprehensive';
  const role = ROLE_BY_STATUS[mode]?.[status];
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
