/**
 * Agent Configuration Router
 *
 * Manages agent CRUD operations, default agent selection, and config schema retrieval.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { fromJsonString } from '../../../utils/database/db-helpers';
import {
  getAgentConfigSchema,
  getAllAgentConfigSchemas,
} from '../../../utils/agent/agent-config-schema';
import { logAgentConfigChange } from '../../../utils/agent/agent-audit-log';
import { NotFoundError, ValidationError, parseId } from '../../../middleware/error-handler';

export const agentConfigRouter = new Elysia()
  // Agent configuration list (active only)
  .get('/agents', async () => {
    const agents = await prisma.aIAgentConfig.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // NOTE: Only expose development, review, and default agents — other types are internal-only.
    const filteredAgents = agents.filter((agent: (typeof agents)[0]) => {
      const isDevelopmentAgent = agent.name.includes('Development Agent');
      const isReviewAgent = agent.name.includes('Review Agent');
      const isDefaultAgent = agent.isDefault;

      return isDevelopmentAgent || isReviewAgent || isDefaultAgent;
    });

    return filteredAgents.map((agent: (typeof filteredAgents)[0]) => ({
      ...agent,
      capabilities: fromJsonString(agent.capabilities) ?? {},
    }));
  })

  // Agent configuration list (all, including inactive - for management page)
  .get('/agents/all', async () => {
    const agents = await prisma.aIAgentConfig.findMany({
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return agents.map((agent: (typeof agents)[0]) => ({
      ...agent,
      capabilities: fromJsonString(agent.capabilities) ?? {},
    }));
  })

  // Toggle agent active status
  .put(
    '/agents/:id/toggle-active',
    async (context) => {
      const { params } = context;
      const agentId = parseId(params.id, 'agent ID');

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
      });
      if (!agent) {
        throw new NotFoundError('Agent not found');
      }

      // NOTE: Default agent must remain active — deactivation requires reassigning default first.
      if (agent.isDefault && agent.isActive) {
        throw new ValidationError(
          'デフォルトエージェントは無効化できません。先に別のエージェントをデフォルトに設定してください。',
        );
      }

      const updated = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: { isActive: !agent.isActive },
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
        action: 'update',
        changeDetails: {
          isActive: { from: agent.isActive, to: updated.isActive },
        },
        previousValues: { isActive: agent.isActive },
        newValues: { isActive: updated.isActive },
      });

      return updated;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Get default agent configuration
  .get('/agents/default', async () => {
    const defaultAgent = await prisma.aIAgentConfig.findFirst({
      where: { isDefault: true, isActive: true },
    });
    if (!defaultAgent) {
      // NOTE: Falls back to built-in Claude Code when no default is configured in DB.
      return {
        id: null,
        agentType: 'claude-code',
        name: 'Claude Code Agent',
        modelId: null,
        isDefault: true,
        isActive: true,
        isBuiltinFallback: true,
      };
    }
    return {
      ...defaultAgent,
      capabilities: fromJsonString(defaultAgent.capabilities) ?? {},
      isBuiltinFallback: false,
    };
  })

  // Set default agent by ID
  .put(
    '/agents/:id/set-default',
    async (context) => {
      const { params } = context;
      const agentId = parseId(params.id, 'agent ID');

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
      });
      if (!agent) {
        throw new NotFoundError('Agent not found');
      }
      if (!agent.isActive) {
        throw new ValidationError('Cannot set inactive agent as default');
      }

      // NOTE: Transaction ensures exactly one agent is default at any time.
      const result = await prisma.$transaction(async (tx) => {
        await tx.aIAgentConfig.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });

        const newDefault = await tx.aIAgentConfig.update({
          where: { id: agentId },
          data: { isDefault: true },
        });

        return newDefault;
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
        action: 'update',
        changeDetails: {
          isDefault: { from: false, to: true },
        },
        previousValues: { isDefault: false },
        newValues: { isDefault: true },
      });

      return result;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Remove default agent (unset default)
  .delete('/agents/default', async () => {
    const defaultAgent = await prisma.aIAgentConfig.findFirst({
      where: { isDefault: true },
    });

    if (!defaultAgent) {
      throw new NotFoundError('No default agent is currently set');
    }

    const updated = await prisma.aIAgentConfig.update({
      where: { id: defaultAgent.id },
      data: { isDefault: false },
    });

    await logAgentConfigChange({
      agentConfigId: defaultAgent.id,
      action: 'update',
      changeDetails: {
        isDefault: { from: true, to: false },
      },
      previousValues: { isDefault: true },
      newValues: { isDefault: false },
    });

    return { success: true, message: 'Default agent unset successfully' };
  })

  // Get all agent configuration schemas
  .get('/agents/config-schemas', async () => {
    return {
      schemas: getAllAgentConfigSchemas(),
    };
  })

  // Get configuration schema for a specific agent type
  .get(
    '/agents/config-schema/:agentType',
    async ({ params }) => {
      const { agentType } = params;
      const schema = getAgentConfigSchema(agentType);

      if (!schema) {
        throw new NotFoundError(`Unknown agent type: ${agentType}`);
      }

      return { schema };
    },
    {
      params: t.Object({
        agentType: t.String(),
      }),
    },
  );
