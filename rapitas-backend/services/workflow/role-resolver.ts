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

/** Role that owns each workflow status, per workflow mode. Mirrors workflow-orchestrator. */
const ROLE_BY_STATUS: Record<WorkflowMode, Partial<Record<WorkflowStatus, WorkflowRole>>> = {
  comprehensive: {
    draft: 'researcher',
    research_done: 'planner',
    plan_created: 'reviewer',
    plan_approved: 'implementer',
    in_progress: 'verifier',
  },
  standard: {
    draft: 'planner',
    plan_created: 'reviewer',
    plan_approved: 'implementer',
    in_progress: 'verifier',
  },
  lightweight: {
    draft: 'implementer',
    in_progress: 'auto_verifier',
  },
};

export interface ResolvedRoleAgent {
  role: WorkflowRole;
  agentConfigId: number | null;
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
    select: { agentConfigId: true, isEnabled: true },
  });
  if (!roleConfig || !roleConfig.isEnabled) {
    log.debug({ taskId, role }, 'Role not configured or disabled');
    return { role, agentConfigId: null };
  }
  return { role, agentConfigId: roleConfig.agentConfigId };
}
