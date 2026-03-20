/**
 * ModelFetcher
 *
 * Fetches available AI models from each provider's API and caches the
 * result in memory for one hour to avoid excessive API calls.
 *
 * Not responsible for HTTP routing or API-key persistence.
 */

import { prisma } from '../../../config/database';
import { decrypt } from '../../../utils/encryption';
import { getApiKeyForProvider } from '../../../utils/ai-client';
import { createLogger } from '../../../config/logger';
import {
  FALLBACK_MODELS,
  type ClaudeModelsResponse,
  type OpenAIModelsResponse,
  type GeminiModelsResponse,
} from './settings-types';

const log = createLogger('routes:settings:model-fetcher');

// NOTE(agent): Module-level cache avoids repeated provider API calls within the same hour.
let modelCache: {
  data: Record<string, Array<{ value: string; label: string }>>;
  expiresAt: number;
} | null = null;

const MODEL_CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Fetches available models dynamically from all configured providers.
 * Uses an in-memory cache; falls back to FALLBACK_MODELS on any fetch failure.
 *
 * @returns Map of provider ID → model list / プロバイダID→モデルリストのマップ
 */
export async function fetchAvailableModels(): Promise<
  Record<string, Array<{ value: string; label: string }>>
> {
  if (modelCache && modelCache.expiresAt > Date.now()) {
    return modelCache.data;
  }

  const models: Record<string, Array<{ value: string; label: string }>> = {};

  try {
    // Fetch Claude models from Anthropic API
    const claudeApiKey = await getApiKeyForProvider('claude');
    if (claudeApiKey) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': claudeApiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        if (response.ok) {
          const data = (await response.json()) as ClaudeModelsResponse;
          models.claude =
            data.models?.map((model) => ({
              value: model.id,
              label: model.display_name || model.id,
            })) || FALLBACK_MODELS.claude;
        } else {
          models.claude = FALLBACK_MODELS.claude;
        }
      } catch {
        models.claude = FALLBACK_MODELS.claude;
      }
    } else {
      models.claude = FALLBACK_MODELS.claude;
    }

    // Fetch OpenAI models
    const settings = await prisma.userSettings.findFirst();
    const openaiApiKey = settings?.chatgptApiKeyEncrypted
      ? decrypt(settings.chatgptApiKeyEncrypted)
      : null;
    if (openaiApiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${openaiApiKey}` },
        });
        if (response.ok) {
          const data = (await response.json()) as OpenAIModelsResponse;
          const gptModels =
            data.data
              ?.filter((model) => model.id.includes('gpt') || model.id.includes('o1'))
              .map((model) => ({
                value: model.id,
                label: model.id.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
              })) || [];
          models.chatgpt = gptModels.length > 0 ? gptModels : FALLBACK_MODELS.chatgpt;
        } else {
          models.chatgpt = FALLBACK_MODELS.chatgpt;
        }
      } catch {
        models.chatgpt = FALLBACK_MODELS.chatgpt;
      }
    } else {
      models.chatgpt = FALLBACK_MODELS.chatgpt;
    }

    // Fetch Gemini models
    const geminiApiKey = settings?.geminiApiKeyEncrypted
      ? decrypt(settings.geminiApiKeyEncrypted)
      : null;
    if (geminiApiKey) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${geminiApiKey}`,
        );
        if (response.ok) {
          const data = (await response.json()) as GeminiModelsResponse;
          const geminiModels =
            data.models
              ?.filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
              .map((model) => ({
                value: model.name.replace('models/', ''),
                label: model.displayName || model.name.replace('models/', ''),
              })) || [];
          models.gemini = geminiModels.length > 0 ? geminiModels : FALLBACK_MODELS.gemini;
        } else {
          models.gemini = FALLBACK_MODELS.gemini;
        }
      } catch {
        models.gemini = FALLBACK_MODELS.gemini;
      }
    } else {
      models.gemini = FALLBACK_MODELS.gemini;
    }
  } catch (error) {
    log.error({ err: error }, 'Error fetching dynamic models');
    return FALLBACK_MODELS;
  }

  modelCache = {
    data: models,
    expiresAt: Date.now() + MODEL_CACHE_DURATION,
  };

  return models;
}
