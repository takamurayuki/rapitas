/**
 * Agent API Key Router
 *
 * Handles storing, replacing, and deleting encrypted API keys for agent configs.
 * Not responsible for agent CRUD or connection testing.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import { maskApiKey, isEncryptionKeyConfigured } from '../../../utils/common/encryption';
import { deleteStoredSecret, saveAgentApiKey } from '../../../utils/common/secret-store';
import { logAgentConfigChange } from '../../../utils/agent/agent-audit-log';
import { parseId } from '../../../middleware/error-handler';

const log = createLogger('routes:agent-api-key');

export const agentApiKeyRouter = new Elysia()

  .post(
    '/agents/:id/api-key',
    async (context) => {
      const { set } = context;
      const { id } = context.params as { id: string };
      // NOTE(#1349): one validated conversion for the whole handler. The raw id
      // was converted at four separate points — the lookup, the secret store,
      // the row update and the audit entry — so POST /agents/5abc/api-key wrote
      // an API key onto agent 5. The type assertion above is what hid this from
      // require-validated-id-param until the rule learned to unwrap assertions.
      const agentId = parseId(id, 'agent ID');
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
        where: { id: agentId },
      });

      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }

      const apiKeyEncrypted = saveAgentApiKey(agentId, apiKey);

      await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: { apiKeyEncrypted },
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
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
      // See the POST handler: validated once, before anything is looked up.
      const agentId = parseId(id, 'agent ID');

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
      });

      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }

      deleteStoredSecret(agent.apiKeyEncrypted);

      await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: { apiKeyEncrypted: null },
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
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
