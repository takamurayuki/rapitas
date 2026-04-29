/**
 * model-discovery/probes/claude-probe
 *
 * Discovers Anthropic Claude models. Order:
 *  1. `https://api.anthropic.com/v1/models` if a key is configured (either in
 *     userSettings or any active AIAgentConfig of agentType claude/claude-code).
 *  2. `claude --help` parsed for model identifiers it knows about. The Claude
 *     Code CLI typically describes its `--model <model>` flag with example
 *     aliases (sonnet / opus / haiku) — we accept whatever the help text
 *     mentions today and tomorrow without baking ids in source.
 *  3. If both fail but the CLI itself is detectable, return zero-models +
 *     available=true so the consumer can still fall back to default tier
 *     resolution.
 */
import { spawn } from 'child_process';
import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';
import { resolveStoredSecret } from '../../../../utils/common/secret-store';
import type { DiscoveredModel, ProviderProbeResult } from '../types';
import { classifyTier, inferCostPer1k } from '../tier-classifier';

const log = createLogger('model-discovery:claude');

interface AnthropicModelsResponse {
  data?: Array<{ id?: string; display_name?: string }>;
}

async function findClaudeApiKey(): Promise<string | null> {
  const settings = await prisma.userSettings.findFirst();
  const settingsKey = (settings as Record<string, unknown> | null)?.claudeApiKeyEncrypted;
  if (typeof settingsKey === 'string' && settingsKey) {
    try {
      const k = resolveStoredSecret(settingsKey);
      if (k) return k;
    } catch {
      // fall through
    }
  }
  const agents = await prisma.aIAgentConfig.findMany({
    where: {
      isActive: true,
      agentType: { in: ['claude', 'claude-code', 'claude-api'] },
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

async function fetchAnthropicModels(apiKey: string): Promise<DiscoveredModel[] | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'Anthropic models endpoint returned non-OK');
      return null;
    }
    const json = (await res.json()) as AnthropicModelsResponse;
    const items = (json.data ?? []).filter((m) => typeof m.id === 'string');
    if (items.length === 0) return null;
    return items.map((m) => {
      const id = m.id!;
      const tier = classifyTier(id);
      return {
        id,
        provider: 'claude',
        tier,
        costPer1kTokens: inferCostPer1k(id, tier),
        source: 'rest-api',
        label: m.display_name || id,
      } satisfies DiscoveredModel;
    });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'Anthropic REST probe failed');
    return null;
  }
}

async function probeClaudeCli(): Promise<DiscoveredModel[] | null> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--help'], {
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
    child.on('close', () => {
      clearTimeout(timeout);
      // Pull both full ids (e.g. `claude-sonnet-4-6`) and short aliases
      // (`opus`, `sonnet`, `haiku`) the help text mentions.
      const fullIds = stdout.match(/\bclaude-[\w.-]+/gi) ?? [];
      const aliases = (stdout.match(/'(sonnet|opus|haiku)'/gi) ?? []).map((q) =>
        q.replace(/'/g, '').toLowerCase(),
      );
      const ids = Array.from(new Set([...fullIds.map((s) => s.toLowerCase()), ...aliases]));
      if (ids.length === 0) return resolve(null);
      resolve(
        ids.map((id) => {
          const tier = classifyTier(id);
          return {
            id,
            provider: 'claude',
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

/** True when `claude --version` exits 0 — confirms the CLI is on PATH. */
async function detectClaudeCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], {
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
 * Probe Claude. Always queries BOTH REST and CLI in parallel and merges the
 * results — `cliOnly` only changes whether an answer counts as "available",
 * not how many models we surface, so the availability widget and the model
 * dropdown stay in sync.
 */
export async function probeClaude(
  options: { cliOnly?: boolean } = {},
): Promise<ProviderProbeResult> {
  const apiKey = await findClaudeApiKey();
  const [cliPresent, cliModels, restModels] = await Promise.all([
    detectClaudeCli(),
    probeClaudeCli(),
    apiKey ? fetchAnthropicModels(apiKey) : Promise.resolve(null),
  ]);

  // Merge — REST wins on duplicate ids because it carries display_name.
  const merged = new Map<string, DiscoveredModel>();
  for (const m of cliModels ?? []) merged.set(m.id, m);
  for (const m of restModels ?? []) merged.set(m.id, m);

  // Strip bare CLI aliases ("sonnet" / "opus" / "haiku") when a concrete
  // versioned model from the same family is already in the set — the alias
  // resolves to one of those versions internally, so listing both is redundant.
  const presentFamilies = new Set<string>();
  const familyRegex = /^claude-(opus|sonnet|haiku)\b/;
  for (const m of merged.values()) {
    const f = familyRegex.exec(m.id);
    if (f) presentFamilies.add(f[1]);
  }
  for (const id of Array.from(merged.keys())) {
    if (/^(opus|sonnet|haiku)$/.test(id) && presentFamilies.has(id)) {
      merged.delete(id);
    }
  }
  const models = Array.from(merged.values());

  // Availability rule:
  // - cliOnly: CLI must be detected
  // - default: either CLI detected or REST returned models
  const available = options.cliOnly ? cliPresent : cliPresent || (restModels?.length ?? 0) > 0;

  if (!available) {
    return {
      provider: 'claude',
      available: false,
      reason: options.cliOnly
        ? 'claude CLI が検出できません'
        : 'Anthropic API キーも claude CLI も検出できず',
      models: [],
    };
  }
  return { provider: 'claude', available: true, models };
}
