/**
 * Setup Routes
 *
 * Powers the first-run wizard. Returns a single status payload describing
 * everything the wizard needs to render: which database provider is active
 * and whether it is reachable, which AI providers are usable (CLI auth
 * status), and whether Ollama is running.
 *
 * Designed for both deployment shapes:
 *   - Tauri desktop:  RAPITAS_DB_PROVIDER=sqlite, DATABASE_URL=file:...
 *   - Web/server:     DATABASE_URL=postgresql://...
 */

import fs from 'fs';
import path from 'path';
import { Elysia } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { discoverModels } from '../../services/ai/model-discovery';
import { getLocalLLMStatus } from '../../services/local-llm';

const log = createLogger('routes:setup');

type DbProvider = 'sqlite' | 'postgresql' | 'unknown';

function detectProvider(): DbProvider {
  if (
    process.env.RAPITAS_DB_PROVIDER === 'sqlite' ||
    process.env.DATABASE_URL?.startsWith('file:')
  ) {
    return 'sqlite';
  }
  if (process.env.DATABASE_URL?.startsWith('postgres')) return 'postgresql';
  return 'unknown';
}

interface DbStatus {
  provider: DbProvider;
  connected: boolean;
  detail: string;
  /** SQLite-only: absolute path to the .db file. */
  filePath?: string;
  /** SQLite-only: file size in bytes. */
  fileSizeBytes?: number;
}

async function checkDatabase(): Promise<DbStatus> {
  const provider = detectProvider();

  if (provider === 'sqlite') {
    const url = process.env.DATABASE_URL ?? '';
    const filePath = path.resolve(url.replace(/^file:/, ''));
    if (!fs.existsSync(filePath)) {
      return {
        provider,
        connected: false,
        detail: `SQLite database file not found at ${filePath}`,
        filePath,
      };
    }
    try {
      // Lightweight roundtrip via Prisma to verify the schema is loaded.
      await prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 as ok');
      const stat = fs.statSync(filePath);
      return {
        provider,
        connected: true,
        detail: 'SQLite reachable',
        filePath,
        fileSizeBytes: stat.size,
      };
    } catch (err) {
      return {
        provider,
        connected: false,
        detail: err instanceof Error ? err.message : 'SQLite query failed',
        filePath,
      };
    }
  }

  if (provider === 'postgresql') {
    try {
      await prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 as ok');
      return { provider, connected: true, detail: 'PostgreSQL reachable' };
    } catch (err) {
      return {
        provider,
        connected: false,
        detail: err instanceof Error ? err.message : 'PostgreSQL connection failed',
      };
    }
  }

  return {
    provider: 'unknown',
    connected: false,
    detail: 'DATABASE_URL is unset or unrecognized',
  };
}

interface ProviderStatus {
  provider: 'claude' | 'chatgpt' | 'gemini' | 'ollama';
  available: boolean;
  reason: string | null;
  modelCount: number;
}

async function checkProviders(): Promise<ProviderStatus[]> {
  // CLI-only mirrors what /agent-availability uses on the agent management page.
  const result = await discoverModels(false, { cliOnly: true });
  const cliMap = new Map(result.providers.map((p) => [p.provider, p]));

  const ollama = await getLocalLLMStatus().catch(() => ({ available: false }));

  return [
    mapProvider('claude', cliMap.get('claude')),
    mapProvider('chatgpt', cliMap.get('openai')),
    mapProvider('gemini', cliMap.get('gemini')),
    {
      provider: 'ollama',
      available: (ollama as { available: boolean }).available,
      reason: (ollama as { available: boolean }).available ? null : 'Ollama not detected',
      modelCount: 0,
    },
  ];
}

function mapProvider(
  name: ProviderStatus['provider'],
  p: { provider: string; available: boolean; reason?: string; models: unknown[] } | undefined,
): ProviderStatus {
  if (!p) {
    return {
      provider: name,
      available: false,
      reason: 'No probe result',
      modelCount: 0,
    };
  }
  return {
    provider: name,
    available: p.available,
    reason: p.reason ?? null,
    modelCount: p.models.length,
  };
}

export const setupRoutes = new Elysia({ prefix: '/system/setup' }).get('/status', async () => {
  try {
    const [database, providers] = await Promise.all([checkDatabase(), checkProviders()]);
    const setupComplete = database.connected && providers.some((p) => p.available);

    return {
      database,
      providers,
      setupComplete,
      // Surface key environment hints so the wizard can display them as-is.
      env: {
        nodeEnv: process.env.NODE_ENV ?? 'development',
        tauriBuild: process.env.TAURI_BUILD === 'true',
      },
    };
  } catch (err) {
    log.error({ err }, 'Setup status check failed');
    return {
      database: { provider: 'unknown', connected: false, detail: 'check failed' },
      providers: [],
      setupComplete: false,
      env: {},
    };
  }
});
