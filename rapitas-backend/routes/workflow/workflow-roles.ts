/**
 * Workflow Roles Routes
 * AI agent role configuration for each workflow phase (research, plan, review, implement, verify)
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config';

const VALID_ROLES = [
  'researcher',
  'planner',
  'reviewer',
  'implementer',
  'verifier',
  'auto_verifier',
] as const;
type WorkflowRole = (typeof VALID_ROLES)[number];

const DEFAULT_PROMPT_KEYS: Record<WorkflowRole, string> = {
  researcher: 'workflow_role_researcher',
  planner: 'workflow_role_planner',
  reviewer: 'workflow_role_reviewer',
  implementer: 'workflow_role_implementer',
  verifier: 'workflow_role_verifier',
  auto_verifier: 'workflow_role_auto_verifier',
};

/**
 * Initialize missing roles with default values.
 */
async function ensureRolesExist() {
  const existing = await prisma.workflowRoleConfig.findMany({
    select: { role: true },
  });
  const existingRoles = new Set(existing.map((r) => r.role));

  const missing = VALID_ROLES.filter((role) => !existingRoles.has(role));
  if (missing.length > 0) {
    await prisma.workflowRoleConfig.createMany({
      data: missing.map((role) => ({
        role,
        systemPromptKey: DEFAULT_PROMPT_KEYS[role],
        isEnabled: true,
        metadata: '{}',
      })),
    });
  }
}

export const workflowRolesRoutes = new Elysia()
  
  .get('/workflow-roles', async () => {
    await ensureRolesExist();

    const roles = await prisma.workflowRoleConfig.findMany({
      include: {
        agentConfig: {
          select: {
            id: true,
            agentType: true,
            name: true,
            modelId: true,
            isActive: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    // Ensure role ordering
    const roleOrder: WorkflowRole[] = [
      'researcher',
      'planner',
      'reviewer',
      'implementer',
      'verifier',
      'auto_verifier',
    ];
    const sorted = roleOrder.map((role) => roles.find((r) => r.role === role)).filter(Boolean);

    return sorted;
  })

  
  .get('/workflow-roles/:role', async ({ params, set }) => {
    const role = params.role as string;
    if (!VALID_ROLES.includes(role as WorkflowRole)) {
      set.status = 400;
      return { error: `無効なロール: ${role}。有効なロール: ${VALID_ROLES.join(', ')}` };
    }

    await ensureRolesExist();

    const config = await prisma.workflowRoleConfig.findUnique({
      where: { role },
      include: {
        agentConfig: {
          select: {
            id: true,
            agentType: true,
            name: true,
            modelId: true,
            isActive: true,
          },
        },
      },
    });

    if (!config) {
      set.status = 404;
      return { error: 'ロール設定が見つかりません' };
    }

    return config;
  })

  
  .put('/workflow-roles/:role', async ({ params, body, set }) => {
    const role = params.role as string;
    if (!VALID_ROLES.includes(role as WorkflowRole)) {
      set.status = 400;
      return { error: `無効なロール: ${role}` };
    }

    await ensureRolesExist();

    const { agentConfigId, modelId, systemPromptKey, isEnabled, metadata } = body as {
      agentConfigId?: number | null;
      modelId?: string | null;
      systemPromptKey?: string | null;
      isEnabled?: boolean;
      metadata?: string;
    };

    // Check existence when agentConfigId is specified
    if (agentConfigId !== undefined && agentConfigId !== null) {
      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentConfigId },
      });
      if (!agent) {
        set.status = 400;
        return { error: `エージェントID ${agentConfigId} が見つかりません` };
      }
      if (!agent.isActive) {
        set.status = 400;
        return { error: `エージェント "${agent.name}" は無効化されています` };
      }
    }

    // Check existence when systemPromptKey is specified
    if (systemPromptKey !== undefined && systemPromptKey !== null) {
      const prompt = await prisma.systemPrompt.findUnique({
        where: { key: systemPromptKey },
      });
      if (!prompt) {
        set.status = 400;
        return { error: `システムプロンプト "${systemPromptKey}" が見つかりません` };
      }
    }

    const updateData: Record<string, unknown> = {};
    if (agentConfigId !== undefined) updateData.agentConfigId = agentConfigId;
    if (modelId !== undefined) updateData.modelId = modelId;
    if (systemPromptKey !== undefined) updateData.systemPromptKey = systemPromptKey;
    if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
    if (metadata !== undefined) updateData.metadata = metadata;

    const updated = await prisma.workflowRoleConfig.update({
      where: { role },
      data: updateData,
      include: {
        agentConfig: {
          select: {
            id: true,
            agentType: true,
            name: true,
            modelId: true,
            isActive: true,
          },
        },
      },
    });

    return updated;
  })

  // Reset all roles to defaults
  .post('/workflow-roles/initialize', async () => {
    await ensureRolesExist();

    const roles = await prisma.workflowRoleConfig.findMany({
      include: {
        agentConfig: {
          select: {
            id: true,
            agentType: true,
            name: true,
            modelId: true,
            isActive: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return { message: 'ロール初期化完了', roles };
  });
