/**
 * Agent API Key Router
 *
 * Handles storing, replacing, and deleting encrypted API keys for agent configs.
 * Not responsible for agent CRUD or connection testing.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { encrypt, maskApiKey, isEncryptionKeyConfigured } from '../../utils/encryption';
import { logAgentConfigChange } from '../../utils/agent-audit-log';

const log = createLogger('routes:agent-api-key');

export const agentApiKeyRouter = new Elysia()

  .post(
    '/agents/:id/api-key',
    async (context) => {
      const { set } = context;
      const { id } = context.params as { id: string };
      const { apiKey } = context.body as { apiKey: string };

      if (!apiKey) {
        set.status = 400;
        return { error: 'API key is required' };
      }

      if (!isEncryptionKeyConfigured()) {
        log.warn(
          '[agents] Encryption key not configured. API keys should be set via environment variables in production.',
        );
      }

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }

      const apiKeyEncrypted = encrypt(apiKey);

      await prisma.aIAgentConfig.update({
        where: { id: parseInt(id) },
        data: { apiKeyEncrypted },
      });

      await logAgentConfigChange({
        agentConfigId: parseInt(id),
        action: 'api_key_set',
        changeDetails: {
          hadApiKeyBefore: !!agent.apiKeyEncrypted,
        },
      });

      return {
        success: true,
        message: 'API key saved successfully',
        apiKeyMasked: maskApiKey(apiKey),
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        apiKey: t.String(),
      }),
    },
  )

  .delete(
    '/agents/:id/api-key',
    async (context) => {
      const { set } = context;
      const { id } = context.params as { id: string };

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: parseInt(id) },
      });

      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }

      await prisma.aIAgentConfig.update({
        where: { id: parseInt(id) },
        data: { apiKeyEncrypted: null },
      });

      await logAgentConfigChange({
        agentConfigId: parseInt(id),
        action: 'api_key_delete',
      });

      return {
        success: true,
        message: 'API key deleted successfully',
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
