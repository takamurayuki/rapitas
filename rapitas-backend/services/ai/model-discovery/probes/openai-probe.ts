/**
 * model-discovery/probes/openai-probe
 *
 * Discovers OpenAI / Codex models. Two-stage strategy:
 *  1. If any active AIAgentConfig of agentType `codex` / `openai` exposes an
 *     API key, query `GET /v1/models` for the live list (this is the fully
 *     dynamic path — handles any model OpenAI ships, including future ones).
 *  2. Otherwise, if the `codex` CLI is installed, query its `--help` for the
 *     model flag and surface the parsed values. We do NOT keep a manual list
 *     of model ids in code.
 */
import { spawn } from 'child_process';
import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';
import { resolveStoredSecret } from '../../../../utils/common/secret-store';
import type { DiscoveredModel, ProviderProbeResult } from '../types';
import { classifyTier, inferCostPer1k } from '../tier-classifier';

const log = createLogger('model-discovery:openai');

interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>;
}

/**
 * Pull the first decrypted OpenAI/Codex API key from active agent configs.
 */
async function findOpenAiApiKey(): Promise<string | null> {
  const agents = await prisma.aIAgentConfig.findMany({
    where: {
      isActive: true,
      OR: [{ agentType: 'codex' }, { agentType: 'openai' }, { agentType: 'chatgpt' }],
      apiKeyEncrypted: { not: null },
    },
    select: { apiKeyEncrypted: true },
  });
  for (const a of agents) {
    if (!a.apiKeyEncrypted) continue;
    try {
      const key = resolveStoredSecret(a.apiKeyEncrypted);
      if (key) return key;
    } catch {
      // Try next agent on decryption failure.
    }
  }
  return null;
}

/** Try the live REST `/models` endpoint. */
async function fetchOpenAiModels(apiKey: string): Promise<DiscoveredModel[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'OpenAI models endpoint returned non-OK');
      return null;
    }
    const json = (await res.json()) as OpenAiModelsResponse;
    const ids = (json.data ?? []).map((m) => m.id).filter(Boolean) as string[];
    // OpenAI's /models endpoint includes embeddings/whisper/etc. — narrow to chat
    // completion families. Anything starting with `gpt-` or `o\d` qualifies.
    const chatIds = ids.filter((id) => /^(gpt-|o\d)/.test(id));
    return chatIds.map((id) => {
      const tier = classifyTier(id);
      return {
        id,
        provider: 'openai',
        tier,
        costPer1kTokens: inferCostPer1k(id, tier),
        source: 'rest-api',
        label: id,
      } satisfies DiscoveredModel;
    });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'OpenAI REST probe failed');
    return null;
  }
}

interface CodexDebugModelEntry {
  slug?: string;
  display_name?: string;
  description?: string;
  visibility?: string;
  supported_in_api?: boolean;
}

interface CodexDebugModelsResponse {
  models?: CodexDebugModelEntry[];
}

/**
 * Run `codex debug models` (the CLI's built-in model catalog dump) and
 * convert the entries into DiscoveredModel form. Preferred over parsing
 * `--help` because the catalog is a well-formed JSON contract maintained
 * alongside the binary.
 *
 * Falls back to `codex --help` text matching when the debug command is
 * absent (older CLI versions may not ship it).
 */
async function probeCodexCli(): Promise<DiscoveredModel[] | null> {
  const fromCatalog = await runCodexDebugModels();
  if (fromCatalog && fromCatalog.length > 0) return fromCatalog;
  return runCodexHelpFallback();
}

function runCodexDebugModels(): Promise<DiscoveredModel[] | null> {
  return new Promise((resolve) => {
    const child = spawn('codex', ['debug', 'models'], {
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || stdout.length === 0) {
        resolve(null);
        return;
      }
      try {
        const start = stdout.indexOf('{');
        if (start < 0) return resolve(null);
        const parsed = JSON.parse(stdout.slice(start)) as CodexDebugModelsResponse;
        const visible = (parsed.models ?? []).filter(
          (m): m is Required<Pick<CodexDebugModelEntry, 'slug'>> & CodexDebugModelEntry =>
            !!m.slug && m.visibility !== 'hidden',
        );
        if (visible.length === 0) return resolve(null);
        resolve(
          visible.map((m) => {
            const tier = classifyTier(m.slug);
            return {
              id: m.slug,
              provider: 'openai',
              tier,
              costPer1kTokens: inferCostPer1k(m.slug, tier),
              source: 'cli-alias',
              label: m.display_name || m.slug,
            } satisfies DiscoveredModel;
          }),
        );
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : err },
          'codex debug models JSON parse failed',
        );
        resolve(null);
      }
    });
  });
}

function runCodexHelpFallback(): Promise<DiscoveredModel[] | null> {
  return new Promise((resolve) => {
    const child = spawn('codex', ['--help'], {
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && stdout.length === 0) {
        resolve(null);
        return;
      }
      const matches = stdout.match(/\b(?:gpt-[\w.-]+|o\d-[\w.-]+|o\d\b)/gi) ?? [];
      const unique = Array.from(new Set(matches.map((m) => m.toLowerCase())));
      if (unique.length === 0) {
        resolve(null);
        return;
      }
      resolve(
        unique.map((id) => {
          const tier = classifyTier(id);
          return {
            id,
            provider: 'openai',
            tier,
            costPer1kTokens: inferCostPer1k(id, tier),
            source: 'cli-alias',
            label: id,
          } satisfies DiscoveredModel;
        }),
      );
    });
  });
}

/**
 * Discover OpenAI / Codex models, preferring the live REST listing.
 */
/** True when `codex --version` exits 0 — confirms the CLI is on PATH. */
async function detectCodexCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('codex', ['--version'], {
      shell: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 4000);
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

/**
 * Probe OpenAI / Codex. Combines REST list (when a key is known) with
 * `codex debug models` output, so the availability widget and model
 * dropdown agree on the same set.
 */
export async function probeOpenAi(
  options: { cliOnly?: boolean } = {},
): Promise<ProviderProbeResult> {
  const apiKey = await findOpenAiApiKey();
  const [cliPresent, cliModels, restModels] = await Promise.all([
    detectCodexCli(),
    probeCodexCli(),
    apiKey ? fetchOpenAiModels(apiKey) : Promise.resolve(null),
  ]);

  const merged = new Map<string, DiscoveredModel>();
  for (const m of cliModels ?? []) merged.set(m.id, m);
  for (const m of restModels ?? []) merged.set(m.id, m);
  const models = Array.from(merged.values());

  const available = options.cliOnly ? cliPresent : cliPresent || (restModels?.length ?? 0) > 0;

  if (!available) {
    return {
      provider: 'openai',
      available: false,
      reason: options.cliOnly
        ? 'codex CLI が検出できません'
        : 'OpenAI API キーも codex CLI も検出できず',
      models: [],
    };
  }
  return { provider: 'openai', available: true, models };
}
