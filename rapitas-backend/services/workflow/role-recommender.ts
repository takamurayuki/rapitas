/**
 * role-recommender
 *
 * Picks the best agent for a workflow role when no explicit
 * `WorkflowRoleConfig` assignment exists. Complements `role-resolver` which
 * reads explicit assignments — recommender is the auto-fallback.
 *
 * Algorithm:
 *   1. Fetch all installed & active AIAgentConfig rows.
 *   2. Score each by `scoreAgentForRole(type, role)`.
 *   3. Return the highest-scoring agent (ties broken by isDefault, then id).
 *   4. If no agent has a positive score, return null — caller should error.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  scoreAgentForRole,
  getCapability,
  type WorkflowRole,
} from '../agents/capabilities/agent-capabilities';

const log = createLogger('role-recommender');

export interface RecommendedAgent {
  agentConfigId: number;
  agentType: string;
  agentName: string;
  score: number;
  /** Brief reason / score breakdown for the user-visible audit log. */
  reason: string;
}

/**
 * Recommend the best installed agent for a workflow role.
 *
 * @param role - Workflow role (researcher / planner / etc) / ワークフローのロール
 * @returns Best agent or null when none of the installed agents fit / 最適なエージェントまたはnull
 */
export async function recommendAgentForRole(role: WorkflowRole): Promise<RecommendedAgent | null> {
  const agents = await prisma.aIAgentConfig
    .findMany({
      where: { isActive: true, isInstalled: true },
      select: { id: true, agentType: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    })
    .catch((err) => {
      log.warn({ err, role }, '[recommendAgentForRole] Failed to fetch installed agents');
      return [];
    });

  if (agents.length === 0) {
    log.warn({ role }, '[recommendAgentForRole] No installed agents found');
    return null;
  }

  const scored = agents
    .map((agent) => ({
      agent,
      score: scoreAgentForRole(agent.agentType, role),
      capability: getCapability(agent.agentType),
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.agent.isDefault !== b.agent.isDefault) return a.agent.isDefault ? -1 : 1;
      return a.agent.id - b.agent.id;
    });

  const best = scored[0];
  if (!best || best.score <= 0) {
    log.warn(
      { role, candidates: scored.map((s) => ({ type: s.agent.agentType, score: s.score })) },
      '[recommendAgentForRole] No suitable agent for role',
    );
    return null;
  }

  const reason = buildReason(role, best.score, best.capability.notes);
  log.info(
    {
      role,
      pickedAgent: best.agent.name,
      pickedType: best.agent.agentType,
      score: best.score,
    },
    '[recommendAgentForRole] Picked agent for role',
  );
  return {
    agentConfigId: best.agent.id,
    agentType: best.agent.agentType,
    agentName: best.agent.name,
    score: best.score,
    reason,
  };
}

function buildReason(role: WorkflowRole, score: number, capabilityNotes: string): string {
  if (score >= 80) return `Strong fit for ${role} (score=${score}). ${capabilityNotes}`;
  if (score >= 50) return `Acceptable fit for ${role} (score=${score}). ${capabilityNotes}`;
  return `Marginal fit for ${role} (score=${score}); consider reassigning. ${capabilityNotes}`;
}
