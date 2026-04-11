/**
 * Agent Discovery Router
 *
 * Exposes available agent types, models, and preset configuration endpoints
 * (development agent and review agent setup).
 * Not responsible for connection testing or agent record CRUD.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config';
import { agentFactory } from '../../../services/agents/agent-factory';
import { getModelsForAgentType, getAllModels } from '../../../utils/agent/agent-models';
import {
  validateApiKeyFormat,
  validateAgentConfig,
} from '../../../utils/agent/agent-config-schema';

export const agentDiscoveryRouter = new Elysia()

  // Available agent types
  .get('/agents/types', async () => {
    const registered = agentFactory.getRegisteredAgents();
    const available = await agentFactory.getAvailableAgents();
    return {
      registered,
      available: available.map((a) => a.type),
    };
  })

  // Get available models for a specific agent type (or all types)
  .get('/agents/models', async (context) => {
    const { query } = context;
    if (query.type) {
      const models = await getModelsForAgentType(query.type);
      return { models };
    }
    const allModels = await getAllModels();
    return allModels;
  })

  // Set development agent configuration (find-or-create + set as default)
  .post(
    '/agents/development',
    async (context) => {
      const { type, model } = context.body as { type: string; model: string };

      let agent = await prisma.aIAgentConfig.findFirst({
        where: { agentType: type, isActive: true },
      });

      if (!agent) {
        agent = await prisma.aIAgentConfig.create({
          data: {
            agentType: type,
            name: `Development Agent (${type})`,
            modelId: model,
            isActive: true,
            isDefault: false,
            capabilities: JSON.stringify({
              codeGeneration: true,
              taskAnalysis: true,
              fileOperations: true,
              terminalAccess: true,
              gitOperations: true,
            }),
          },
        });
      } else {
        agent = await prisma.aIAgentConfig.update({
          where: { id: agent.id },
          data: { modelId: model, name: `Development Agent (${type})` },
        });
      }

      // Set as default agent for development tasks
      await prisma.aIAgentConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      await prisma.aIAgentConfig.update({
        where: { id: agent.id },
        data: { isDefault: true },
      });

      return { success: true, agent };
    },
    {
      body: t.Object({ type: t.String(), model: t.String() }),
    },
  )

  // Set review agent configuration (find-or-create)
  .post(
    '/agents/review',
    async (context) => {
      const { type, model } = context.body as { type: string; model: string };

      let agent = await prisma.aIAgentConfig.findFirst({
        where: {
          agentType: type,
          name: { contains: 'Review' },
          isActive: true,
        },
      });

      if (!agent) {
        agent = await prisma.aIAgentConfig.create({
          data: {
            agentType: type,
            name: `Review Agent (${type})`,
            modelId: model,
            isActive: true,
            isDefault: false,
            capabilities: JSON.stringify({
              codeReview: true,
              taskAnalysis: true,
              fileOperations: true,
              webSearch: true,
            }),
          },
        });
      } else {
        agent = await prisma.aIAgentConfig.update({
          where: { id: agent.id },
          data: { modelId: model },
        });
      }

      return { success: true, agent };
    },
    {
      body: t.Object({ type: t.String(), model: t.String() }),
    },
  )

  // Validate agent configuration without persisting
  .post('/agents/validate-config', async ({ body, set }) => {
    const { agentType, apiKey, endpoint, modelId, additionalConfig } = body as {
      agentType: string;
      apiKey?: string;
      endpoint?: string;
      modelId?: string;
      additionalConfig?: Record<string, unknown>;
    };

    const errors: string[] = [];

    if (apiKey) {
      const apiKeyResult = validateApiKeyFormat(agentType, apiKey);
      if (!apiKeyResult.valid && apiKeyResult.message) {
        errors.push(apiKeyResult.message);
      }
    }

    const configResult = validateAgentConfig(agentType, { endpoint, modelId, additionalConfig });
    if (!configResult.valid) {
      errors.push(...configResult.errors);
    }

    if (errors.length > 0) {
      set.status = 400;
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  });
