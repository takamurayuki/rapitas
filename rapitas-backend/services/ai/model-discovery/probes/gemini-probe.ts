/**
 * model-discovery/probes/gemini-probe
 *
 * Discovers Google Gemini models. Two-stage strategy mirrors the OpenAI
 * probe:
 *  1. If an active AIAgentConfig of agentType `gemini` carries an API key,
 *     query `GET /v1beta/models` for the live list.
 *  2. Otherwise, parse `gemini --help` output for any model identifiers it
 *     advertises. We never hardcode model ids in source.
 */
import { spawn } from 'child_process';
import { readFile, readdir } from 'fs/promises';
import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';
import { resolveStoredSecret } from '../../../../utils/common/secret-store';
import type { DiscoveredModel, ProviderProbeResult } from '../types';
import { classifyTier, inferCostPer1k } from '../tier-classifier';

const log = createLogger('model-discovery:gemini');

interface GeminiModelsResponse {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
}

async function findGeminiApiKey(): Promise<string | null> {
  const agents = await prisma.aIAgentConfig.findMany({
    where: {
      isActive: true,
      agentType: { in: ['gemini', 'gemini-cli'] },
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
      // try next
    }
  }
  return null;
}

async function fetchGeminiModels(apiKey: string): Promise<DiscoveredModel[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) {
      log.warn({ status: res.status }, 'Gemini models endpoint returned non-OK');
      return null;
    }
    const json = (await res.json()) as GeminiModelsResponse;
    const ids = (json.models ?? [])
      .filter(
        (m) =>
          (m.supportedGenerationMethods ?? []).includes('generateContent') &&
          typeof m.name === 'string',
      )
      .map((m) => m.name!.replace(/^models\//, ''));
    if (ids.length === 0) return null;
    return ids.map((id) => {
      const tier = classifyTier(id);
      return {
        id,
        provider: 'gemini',
        tier,
        costPer1kTokens: inferCostPer1k(id, tier),
        source: 'rest-api',
        label: id,
      } satisfies DiscoveredModel;
    });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'Gemini REST probe failed');
    return null;
  }
}

/** Fast presence check — `gemini --version` exits 0 when the CLI is reachable. */
async function detectGeminiCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('gemini', ['--version'], {
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
 * Locate the installed `@google/gemini-cli` package via `npm root -g` and
 * extract the structured model constants from its bundle. The CLI defines
 * canonical user-facing model ids in `packages/core/dist/src/config/models.js`
 * with declarations like:
 *
 *   var PREVIEW_GEMINI_MODEL = "gemini-3-pro-preview";
 *   var DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
 *
 * Parsing these constants (rather than every `"gemini-…"` literal) yields
 * exactly the set the interactive `/model` picker shows — Pro / Flash /
 * Flash Lite for both the Gemini 3 preview and the Gemini 2.5 default
 * tracks — without dragging in internal experiment / test ids.
 *
 * Constants embedding "EMBEDDING" or "VOICE" are skipped because they are
 * non-chat and don't belong in the agent model dropdown.
 */
async function probeGeminiBundle(): Promise<DiscoveredModel[] | null> {
  const root = await runNpmRootGlobal();
  if (!root) return null;
  const bundleDir = `${root}/@google/gemini-cli/bundle`;
  let entries: string[] = [];
  try {
    entries = await readdir(bundleDir);
  } catch {
    return null;
  }
  const found = new Map<string, { id: string; constName: string }>();
  // e.g. `var PREVIEW_GEMINI_FLASH_MODEL = "gemini-3-flash-preview";`
  const constRegex = /\bvar\s+([A-Z][A-Z0-9_]*_MODEL)\s*=\s*"(gemini-[\w.-]+)"/g;
  for (const entry of entries) {
    if (!entry.endsWith('.js')) continue;
    let content: string;
    try {
      content = await readFile(`${bundleDir}/${entry}`, 'utf-8');
    } catch {
      continue;
    }
    let match: RegExpExecArray | null;
    while ((match = constRegex.exec(content)) !== null) {
      const constName = match[1];
      const id = match[2].toLowerCase();
      // Skip non-chat / specialty constants (embeddings, voice, hidden test rigs).
      if (/EMBEDDING|VOICE|TEST|MOCK/.test(constName)) continue;
      if (id.includes('embedding')) continue;
      if (!found.has(id)) found.set(id, { id, constName });
    }
  }
  if (found.size === 0) return null;
  return Array.from(found.values()).map(({ id, constName }) => {
    const tier = classifyTier(id);
    return {
      id,
      provider: 'gemini',
      tier,
      costPer1kTokens: inferCostPer1k(id, tier),
      source: 'cli-alias',
      label: prettyGeminiLabel(id, constName),
    } satisfies DiscoveredModel;
  });
}

/** Render `gemini-2.5-flash-lite` → `Gemini 2.5 Flash Lite`. */
function prettyGeminiLabel(id: string, _constName: string): string {
  return id
    .replace(/^gemini-/, 'Gemini ')
    .replace(/-(\d)/g, ' $1')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resolve the absolute path of the global npm root (used to find the bundle). */
async function runNpmRootGlobal(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['root', '-g'], {
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 5000);
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return resolve(null);
      const path = stdout.trim();
      resolve(path || null);
    });
  });
}

/**
 * Probe Gemini. Combines REST API output (when a key is known) with bundle
 * scanning (no key required) so both the availability indicator and the
 * model dropdown stay in sync.
 */
export async function probeGemini(
  options: { cliOnly?: boolean } = {},
): Promise<ProviderProbeResult> {
  const apiKey = await findGeminiApiKey();
  const [cliPresent, bundleModels, restModels] = await Promise.all([
    detectGeminiCli(),
    probeGeminiBundle(),
    apiKey ? fetchGeminiModels(apiKey) : Promise.resolve(null),
  ]);

  const merged = new Map<string, DiscoveredModel>();
  for (const m of bundleModels ?? []) merged.set(m.id, m);
  for (const m of restModels ?? []) merged.set(m.id, m);
  const models = Array.from(merged.values());

  const available = options.cliOnly ? cliPresent : cliPresent || (restModels?.length ?? 0) > 0;

  if (!available) {
    return {
      provider: 'gemini',
      available: false,
      reason: options.cliOnly
        ? 'gemini CLI が検出できません'
        : 'Gemini API キーも gemini CLI も検出できず',
      models: [],
    };
  }
  return { provider: 'gemini', available: true, models };
}
