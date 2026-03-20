/**
 * ApiKeyRoutes
 *
 * HTTP routes for managing per-provider API keys:
 * GET/POST/DELETE /settings/api-key, GET /settings/api-keys,
 * POST /settings/api-key/validate, and GET /settings/api-status.
 *
 * Not responsible for model configuration; see settings-routes.ts for that.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { getApiKeyForProvider } from '../../../utils/ai-client';
import { encrypt, decrypt, maskApiKey } from '../../../utils/common/encryption';
import { systemSchemas } from '../../../schemas/system.schema';
import {
  PROVIDER_COLUMNS,
  type ApiProvider,
  isValidProvider,
  validateApiKeyFormat,
} from './settings-types';

export const apiKeyRoutes = new Elysia({ prefix: '/settings' })
  // Get API status
  .get('/api-status', async () => {
    const claudeApiKey = await getApiKeyForProvider('claude');
    return {
      claudeApiKeyConfigured: !!claudeApiKey,
    };
  })

  // Get API key status for a specific provider
  .get(
    '/api-key',
    async ({ query }) => {
      const provider = query.provider || 'claude';

      if (!isValidProvider(provider)) {
        return { configured: false, maskedKey: null, provider };
      }

      const settings = await prisma.userSettings.findFirst();
      if (!settings) {
        return { configured: false, maskedKey: null, provider };
      }

      const column = PROVIDER_COLUMNS[provider];
      const encryptedKey = settings[column];

      if (!encryptedKey) {
        // Fallback to env var for Claude
        if (provider === 'claude' && process.env.CLAUDE_API_KEY) {
          return {
            configured: true,
            maskedKey: maskApiKey(process.env.CLAUDE_API_KEY),
            provider,
            source: 'env',
          };
        }
        return { configured: false, maskedKey: null, provider };
      }

      try {
        const decrypted = decrypt(encryptedKey);
        return {
          configured: true,
          maskedKey: maskApiKey(decrypted),
          provider,
          source: 'db',
        };
      } catch {
        return { configured: false, maskedKey: null, provider };
      }
    },
    {
      query: t.Object({
        provider: t.Optional(t.String()),
      }),
    },
  )

  // Get all providers' API key status
  .get('/api-keys', async () => {
    const settings = await prisma.userSettings.findFirst();
    const providers = Object.keys(PROVIDER_COLUMNS) as ApiProvider[];

    const result: Record<string, { configured: boolean; maskedKey: string | null }> = {};

    for (const provider of providers) {
      const column = PROVIDER_COLUMNS[provider];
      const encryptedKey = settings?.[column];

      if (encryptedKey) {
        try {
          const decrypted = decrypt(encryptedKey);
          result[provider] = { configured: true, maskedKey: maskApiKey(decrypted) };
        } catch {
          result[provider] = { configured: false, maskedKey: null };
        }
      } else if (provider === 'claude' && process.env.CLAUDE_API_KEY) {
        result[provider] = {
          configured: true,
          maskedKey: maskApiKey(process.env.CLAUDE_API_KEY),
        };
      } else {
        result[provider] = { configured: false, maskedKey: null };
      }
    }

    return result;
  })

  // Save API key for a specific provider
  .post(
    '/api-key',
    async ({ body, set }) => {
      const { apiKey, provider = 'claude' } = body as { apiKey: string; provider?: string };

      if (!isValidProvider(provider)) {
        set.status = 400;
        return { error: `無効なプロバイダです: ${provider}` };
      }

      const validation = validateApiKeyFormat(apiKey, provider);
      if (!validation.valid) {
        set.status = 400;
        return { error: validation.error };
      }

      const column = PROVIDER_COLUMNS[provider];
      const encrypted = encrypt(apiKey.trim());

      // Save via upsert (does not overwrite other providers keys)
      const existing = await prisma.userSettings.findFirst();
      if (existing) {
        await prisma.userSettings.update({
          where: { id: existing.id },
          data: { [column]: encrypted },
        });
      } else {
        await prisma.userSettings.create({
          data: { [column]: encrypted },
        });
      }

      return {
        maskedKey: maskApiKey(apiKey.trim()),
        provider,
      };
    },
    {
      body: systemSchemas.aiProviderConfig,
    },
  )

  // Validate API key format for a specific provider
  .post(
    '/api-key/validate',
    async ({ body, set }) => {
      const { apiKey, provider = 'claude' } = body as { apiKey: string; provider?: string };

      if (!isValidProvider(provider)) {
        set.status = 400;
        return { valid: false, error: `無効なプロバイダです: ${provider}` };
      }

      const validation = validateApiKeyFormat(apiKey, provider);
      return validation;
    },
    {
      body: systemSchemas.aiProviderConfig,
    },
  )

  // Delete API key for a specific provider
  .delete(
    '/api-key',
    async ({ query }) => {
      const provider = query.provider || 'claude';

      if (!isValidProvider(provider)) {
        throw new Error(`Invalid provider: ${provider}`);
      }

      const column = PROVIDER_COLUMNS[provider];
      const settings = await prisma.userSettings.findFirst();

      if (settings) {
        await prisma.userSettings.update({
          where: { id: settings.id },
          data: { [column]: null },
        });
      }

      return { success: true, provider };
    },
    {
      query: t.Object({
        provider: t.Optional(t.String()),
      }),
    },
  );
