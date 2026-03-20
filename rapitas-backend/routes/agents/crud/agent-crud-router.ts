/**
 * Agent CRUD Router
 *
 * Handles create, read, update, and delete for AIAgentConfig records.
 * API key management is handled by agent-api-key-router.ts.
 * Not responsible for connection testing, model discovery, or execution management.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import { toJsonString, fromJsonString } from '../../../utils/database/db-helpers';
import { encrypt, decrypt, maskApiKey, isEncryptionKeyConfigured } from '../../../utils/common/encryption';
import { logAgentConfigChange, calculateChanges } from '../../../utils/agent/agent-audit-log';

const log = createLogger('routes:agent-crud');

export const agentCrudRouter = new Elysia()

  .post(
    '/agents',
    async (context) => {
      const { agentType, name, apiKey, endpoint, modelId, capabilities, isDefault } =
        context.body as {
          agentType: string;
          name: string;
          apiKey?: string;
          endpoint?: string;
          modelId?: string;
          capabilities?: Record<string, unknown>;
          isDefault?: boolean;
        };

      if (isDefault) {
        await prisma.aIAgentConfig.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      let apiKeyEncrypted: string | null = null;
      if (apiKey) {
        if (!isEncryptionKeyConfigured()) {
          log.warn(
            '[agents] Encryption key not configured. API keys should be set via environment variables in production.',
          );
        }
        apiKeyEncrypted = encrypt(apiKey);
      }

      const created = await prisma.aIAgentConfig.create({
        data: {
          agentType,
          name,
          apiKeyEncrypted,
          endpoint,
          modelId,
          capabilities: toJsonString(capabilities || {}) ?? '{}',
          isDefault: isDefault || false,
        },
      });

      await logAgentConfigChange({
        agentConfigId: created.id,
        action: 'create',
        newValues: {
          agentType,
          name,
          endpoint,
          modelId,
          hasApiKey: !!apiKey,
          isDefault: isDefault || false,
        },
      });

      return created;
    },
    {
      body: t.Object({
        agentType: t.String(),
        name: t.String(),
        apiKey: t.Optional(t.String()),
        endpoint: t.Optional(t.String()),
        modelId: t.Optional(t.String()),
        capabilities: t.Optional(t.Record(t.String(), t.Unknown())),
        isDefault: t.Optional(t.Boolean()),
      }),
    },
  )

  .patch(
    '/agents/:id',
    async (context) => {
      const { id } = context.params as { id: string };
      const { name, apiKey, clearApiKey, endpoint, modelId, capabilities, isDefault, isActive } =
        context.body as {
          name?: string;
          apiKey?: string;
          clearApiKey?: boolean;
          endpoint?: string;
          modelId?: string;
          capabilities?: Record<string, unknown>;
          isDefault?: boolean;
          isActive?: boolean;
        };

      if (isDefault) {
        await prisma.aIAgentConfig.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      const previous = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      let apiKeyEncrypted: string | null | undefined = undefined;
      if (clearApiKey) {
        apiKeyEncrypted = null;
      } else if (apiKey) {
        if (!isEncryptionKeyConfigured()) {
          log.warn(
            '[agents] Encryption key not configured. API keys should be set via environment variables in production.',
          );
        }
        apiKeyEncrypted = encrypt(apiKey);
      }

      const updated = await prisma.aIAgentConfig.update({
        where: { id: parseInt(id) },
        data: {
          ...(name && { name }),
          ...(apiKeyEncrypted !== undefined && { apiKeyEncrypted }),
          ...(endpoint !== undefined && { endpoint }),
          ...(modelId !== undefined && { modelId }),
          ...(capabilities && {
            capabilities: toJsonString(capabilities) ?? '{}',
          }),
          ...(isDefault !== undefined && { isDefault }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      if (previous) {
        const changes = calculateChanges(
          {
            name: previous.name,
            endpoint: previous.endpoint,
            modelId: previous.modelId,
            isDefault: previous.isDefault,
            isActive: previous.isActive,
            hasApiKey: !!previous.apiKeyEncrypted,
          },
          {
            name: updated.name,
            endpoint: updated.endpoint,
            modelId: updated.modelId,
            isDefault: updated.isDefault,
            isActive: updated.isActive,
            hasApiKey: !!updated.apiKeyEncrypted,
          },
        );

        if (Object.keys(changes).length > 0) {
          await logAgentConfigChange({
            agentConfigId: parseInt(id),
            action: 'update',
            changeDetails: changes,
            previousValues: {
              name: previous.name,
              endpoint: previous.endpoint,
              modelId: previous.modelId,
              isDefault: previous.isDefault,
              isActive: previous.isActive,
            },
            newValues: {
              name: updated.name,
              endpoint: updated.endpoint,
              modelId: updated.modelId,
              isDefault: updated.isDefault,
              isActive: updated.isActive,
            },
          });
        }
      }

      return updated;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        clearApiKey: t.Optional(t.Boolean()),
        endpoint: t.Optional(t.String()),
        modelId: t.Optional(t.String()),
        capabilities: t.Optional(t.Record(t.String(), t.Unknown())),
        isDefault: t.Optional(t.Boolean()),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )

  .get(
    '/agents/:id',
    async (context) => {
      const { set } = context;
      const { id } = context.params as { id: string };
      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
        include: {
          _count: { select: { executions: true } },
        },
      });

      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }

      let maskedApiKey: string | null = null;
      let hasApiKey = false;
      if (agent.apiKeyEncrypted) {
        try {
          const decryptedKey = decrypt(agent.apiKeyEncrypted);
          maskedApiKey = maskApiKey(decryptedKey);
          hasApiKey = true;
        } catch (e) {
          log.error({ err: e }, `[agents] Failed to decrypt API key for agent ${id}`);
          maskedApiKey = '*** (decryption failed)';
          hasApiKey = true;
        }
      }

      return {
        ...agent,
        capabilities: fromJsonString(agent.capabilities) ?? {},
        apiKeyEncrypted: undefined, // NOTE: Never expose the encrypted key to the client.
        maskedApiKey,
        apiKeyMasked: maskedApiKey, // NOTE: Alias kept for frontend backward compatibility.
        hasApiKey,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  .delete(
    '/agents/:id',
    async (context) => {
      const { id } = context.params as { id: string };

      const previous = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      const result = await prisma.aIAgentConfig.update({
        where: { id: parseInt(id) },
        data: { isActive: false },
      });

      if (previous) {
        await logAgentConfigChange({
          agentConfigId: parseInt(id),
          action: 'delete',
          previousValues: {
            name: previous.name,
            agentType: previous.agentType,
            isActive: previous.isActive,
          },
        });
      }

      return result;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

;
