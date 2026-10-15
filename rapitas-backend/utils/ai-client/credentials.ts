/**
 * AI Provider API Key Management and Authentication
 */
import { prisma } from '../../config/database';
import { resolveStoredSecret } from '../common/secret-store';
import { createLogger } from '../../config/logger';
import {
  type AIProvider,
  PROVIDER_KEY_COLUMNS,
  PROVIDER_MODEL_COLUMNS,
  DEFAULT_MODELS,
} from './types';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

const log = createLogger('ai-client:credentials');

/** Row shape read from UserSettings; kept loose because the columns are provider-keyed. */
type UserSettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.userSettings.findFirst>>>;

/**
 * Read the singleton UserSettings row, or null when the database cannot be
 * reached. Provider/model/URL lookups only need the row for user overrides,
 * so an unreachable DB must degrade to the built-in defaults instead of
 * throwing: opt-in evaluation scripts run from task worktrees (2026-09-25,
 * #911 `scripts/eval-phase-critic.ts`) have no reachable database, and the
 * throw made a plan's live-evaluation DoD unverifiable by any agent.
 *
 * @returns The settings row, or null on any read failure / 設定行、読めなければ null
 */
/**
 * Warn once per process: the live critic evaluation resolves the provider per
 * lens call, and an unreachable DB logged 100 identical warnings in an hour
 * (log-health filed it as concern #1094, 2026-09-26).
 */
let settingsUnreachableWarned = false;

async function readUserSettings(): Promise<UserSettingsRow | null> {
  try {
    return await prisma.userSettings.findFirst();
  } catch (err) {
    if (!settingsUnreachableWarned) {
      settingsUnreachableWarned = true;
      log.warn(
        { err },
        'UserSettings unreachable — using built-in AI provider defaults (further occurrences in this process are not logged)',
      );
    }
    return null;
  }
}

/**
 * Validate basic format of an API key.
 */
export function isValidApiKeyFormat(apiKey: string, provider: AIProvider): boolean {
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length < 10) return false;

  switch (provider) {
    case 'claude':
      return trimmed.startsWith('sk-ant-api');
    case 'chatgpt':
      return trimmed.startsWith('sk-') && !trimmed.startsWith('sk-ant-api');
    case 'gemini':
      return trimmed.startsWith('AIza');
    default:
      return true;
  }
}

/**
 * Retrieve and decrypt the API key for the specified provider from the DB.
 * DB-stored keys take priority; falls back to environment variables only if absent.
 */
export async function getApiKeyForProvider(provider: AIProvider): Promise<string | null> {
  // Ollama does not require an API key - return URL instead
  if (provider === 'ollama') {
    return await getOllamaUrl();
  }

  // Try DB first (prefer user-configured keys from settings UI)
  const settings = await readUserSettings();
  if (settings) {
    const column = PROVIDER_KEY_COLUMNS[provider];
    const encrypted = settings[column];
    if (encrypted) {
      try {
        const decrypted = resolveStoredSecret(encrypted);
        if (decrypted && isValidApiKeyFormat(decrypted, provider)) {
          return decrypted;
        }
        // Decrypted but invalid format - log warning and fall back to env var
        log.warn(`DB stored ${provider} API key has invalid format, falling back to env var`);
      } catch (error) {
        log.warn(
          {
            err: error instanceof Error ? error : undefined,
            detail: error instanceof Error ? undefined : error,
          },
          `Failed to decrypt ${provider} API key from DB`,
        );
      }
    }
  }

  // If no key in DB, fall back to env var for Claude only
  if (provider === 'claude' && process.env.CLAUDE_API_KEY) {
    const envKey = process.env.CLAUDE_API_KEY;
    if (isValidApiKeyFormat(envKey, provider)) {
      return envKey;
    }
    log.warn('CLAUDE_API_KEY env var has invalid format');
  }

  return null;
}

/**
 * Retrieve the Ollama URL from the DB.
 */
export async function getOllamaUrl(): Promise<string> {
  const settings = await readUserSettings();
  return ((settings as Record<string, unknown>)?.ollamaUrl as string) || DEFAULT_OLLAMA_URL;
}

/**
 * Retrieve the default model for the specified provider from the DB.
 */
export async function getDefaultModel(provider: AIProvider): Promise<string> {
  const settings = await readUserSettings();
  if (settings) {
    const column = PROVIDER_MODEL_COLUMNS[provider];
    const model = settings[column];
    if (model) return model;
  }
  return DEFAULT_MODELS[provider];
}

/**
 * Retrieve the user's default AI provider.
 */
export async function getDefaultProvider(): Promise<AIProvider> {
  const settings = await readUserSettings();
  if (settings?.defaultAiProvider) {
    return settings.defaultAiProvider as AIProvider;
  }
  return 'claude';
}

/**
 * Check whether an API key is configured for the default provider.
 */
export async function isAnyApiKeyConfigured(): Promise<boolean> {
  const provider = await getDefaultProvider();
  const key = await getApiKeyForProvider(provider);
  return !!key;
}

/**
 * Return the list of providers that have been configured.
 */
export async function getConfiguredProviders(): Promise<AIProvider[]> {
  const providers: AIProvider[] = ['claude', 'chatgpt', 'gemini'];
  const configured: AIProvider[] = [];
  for (const p of providers) {
    const key = await getApiKeyForProvider(p);
    if (key) configured.push(p);
  }
  // Ollama is always available (if the local server is running)
  configured.push('ollama');
  return configured;
}
