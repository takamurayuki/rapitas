/**
 * SettingsRoutes
 *
 * HTTP routes for reading and updating user settings, and for managing
 * per-provider default model configuration.
 *
 * Not responsible for API-key management; see api-key-routes.ts for that.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { getApiKeyForProvider } from '../../../utils/ai-client';
import { systemSchemas } from '../../../schemas/system.schema';
import { createLogger } from '../../../config/logger';
import { t } from 'elysia';
import {
  PROVIDER_MODEL_COLUMNS,
  isValidProvider,
} from './settings-types';
import { fetchAvailableModels } from './model-fetcher';

const log = createLogger('routes:settings');

export const settingsRoutes = new Elysia({ prefix: '/settings' })
  // Get settings (create if not exists)
  .get('/', async () => {
    let settings = await prisma.userSettings.findFirst();
    if (!settings) {
      settings = await prisma.userSettings.create({ data: {} });
    }
    const claudeApiKey = await getApiKeyForProvider('claude');
    const apiKeyConfigured = !!claudeApiKey;

    const chatgptConfigured = !!settings.chatgptApiKeyEncrypted;
    const geminiConfigured = !!settings.geminiApiKeyEncrypted;

    return {
      ...settings,
      claudeApiKeyConfigured: apiKeyConfigured,
      chatgptApiKeyConfigured: chatgptConfigured,
      geminiApiKeyConfigured: geminiConfigured,
      // NOTE: Strip encrypted key fields — never expose raw ciphertext to clients.
      claudeApiKeyEncrypted: undefined,
      chatgptApiKeyEncrypted: undefined,
      geminiApiKeyEncrypted: undefined,
      claudeDefaultModel: settings.claudeDefaultModel,
      chatgptDefaultModel: settings.chatgptDefaultModel,
      geminiDefaultModel: settings.geminiDefaultModel,
      defaultAiProvider: settings.defaultAiProvider,
      defaultCategoryId: settings.defaultCategoryId,
      activeMode: settings.activeMode,
    };
  })

  // Update settings
  .patch(
    '/',
    async ({ body, set }) => {
      const {
        developerModeDefault,
        aiTaskAnalysisDefault,
        autoResumeInterruptedTasks,
        autoExecuteAfterCreate,
        autoGenerateTitle,
        autoGenerateTitleDelay,
        autoCreateAfterTitleGeneration,
        autoApprovePlan,
        autoComplexityAnalysis,
        defaultAiProvider,
        defaultCategoryId,
        activeMode,
        ollamaUrl,
        ollamaDefaultModel,
        titleGenerationProvider,
      } = body as {
        developerModeDefault?: boolean;
        aiTaskAnalysisDefault?: boolean;
        autoResumeInterruptedTasks?: boolean;
        autoExecuteAfterCreate?: boolean;
        autoGenerateTitle?: boolean;
        autoGenerateTitleDelay?: number;
        autoCreateAfterTitleGeneration?: boolean;
        autoApprovePlan?: boolean;
        autoComplexityAnalysis?: boolean;
        defaultAiProvider?: string;
        defaultCategoryId?: number;
        activeMode?: string;
        ollamaUrl?: string;
        ollamaDefaultModel?: string;
        titleGenerationProvider?: string | null;
      };

      try {
        let settings = await prisma.userSettings.findFirst();
        if (!settings) {
          settings = await prisma.userSettings.create({
            data: {
              developerModeDefault: developerModeDefault ?? false,
              aiTaskAnalysisDefault: aiTaskAnalysisDefault ?? false,
              autoResumeInterruptedTasks: autoResumeInterruptedTasks ?? false,
              autoExecuteAfterCreate: autoExecuteAfterCreate ?? false,
              autoGenerateTitle: autoGenerateTitle ?? false,
              ...(autoGenerateTitleDelay !== undefined && { autoGenerateTitleDelay }),
              autoCreateAfterTitleGeneration: autoCreateAfterTitleGeneration ?? false,
              autoApprovePlan: autoApprovePlan ?? false,
              ...(autoComplexityAnalysis !== undefined && { autoComplexityAnalysis }),
              ...(defaultCategoryId !== undefined && { defaultCategoryId }),
              ...(activeMode !== undefined && { activeMode }),
              ...(ollamaUrl !== undefined && { ollamaUrl }),
              ...(ollamaDefaultModel !== undefined && { ollamaDefaultModel }),
              ...(titleGenerationProvider !== undefined && { titleGenerationProvider }),
            },
          });
        } else {
          settings = await prisma.userSettings.update({
            where: { id: settings.id },
            data: {
              ...(developerModeDefault !== undefined && { developerModeDefault }),
              ...(aiTaskAnalysisDefault !== undefined && { aiTaskAnalysisDefault }),
              ...(autoResumeInterruptedTasks !== undefined && { autoResumeInterruptedTasks }),
              ...(autoExecuteAfterCreate !== undefined && { autoExecuteAfterCreate }),
              ...(autoGenerateTitle !== undefined && { autoGenerateTitle }),
              ...(autoGenerateTitleDelay !== undefined && { autoGenerateTitleDelay }),
              ...(autoCreateAfterTitleGeneration !== undefined && {
                autoCreateAfterTitleGeneration,
              }),
              ...(autoApprovePlan !== undefined && { autoApprovePlan }),
              ...(autoComplexityAnalysis !== undefined && { autoComplexityAnalysis }),
              ...(defaultAiProvider !== undefined && { defaultAiProvider }),
              ...(defaultCategoryId !== undefined && { defaultCategoryId }),
              ...(activeMode !== undefined && { activeMode }),
              ...(ollamaUrl !== undefined && { ollamaUrl }),
              ...(ollamaDefaultModel !== undefined && { ollamaDefaultModel }),
              ...(titleGenerationProvider !== undefined && { titleGenerationProvider }),
            },
          });
        }

        return settings;
      } catch (error: unknown) {
        log.error({ err: error }, 'Settings update error');
        set.status = 500;
        return {
          error: '設定の保存に失敗しました',
          message: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    {
      body: systemSchemas.userSettings,
    },
  )

  // Get available models for all providers
  .get('/models', async () => {
    return await fetchAvailableModels();
  })

  // Get default model for a specific provider
  .get(
    '/model',
    async ({ query }) => {
      const provider = query.provider || 'claude';

      if (!isValidProvider(provider)) {
        return { provider, model: null };
      }

      const settings = await prisma.userSettings.findFirst();
      if (!settings) {
        return { provider, model: null };
      }

      const column = PROVIDER_MODEL_COLUMNS[provider];
      return { provider, model: settings[column] };
    },
    {
      query: t.Object({
        provider: t.Optional(t.String()),
      }),
    },
  )

  // Save default model for a specific provider
  .post(
    '/model',
    async ({ body, set }) => {
      const { model, provider = 'claude' } = body as { model: string; provider?: string };

      if (!isValidProvider(provider)) {
        set.status = 400;
        return { error: `無効なプロバイダです: ${provider}` };
      }

      const availableModels = await fetchAvailableModels();
      const providerModels = availableModels[provider];
      if (providerModels && model) {
        const validModels = providerModels.map((m) => m.value);
        if (!validModels.includes(model)) {
          set.status = 400;
          return { error: `無効なモデルです: ${model}` };
        }
      }

      const column = PROVIDER_MODEL_COLUMNS[provider];
      const existing = await prisma.userSettings.findFirst();
      if (existing) {
        await prisma.userSettings.update({
          where: { id: existing.id },
          data: { [column]: model || null },
        });
      } else {
        await prisma.userSettings.create({
          data: { [column]: model || null },
        });
      }

      return { provider, model };
    },
    {
      body: systemSchemas.modelConfig,
    },
  );
