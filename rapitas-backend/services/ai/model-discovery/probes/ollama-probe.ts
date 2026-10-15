/**
 * model-discovery/probes/ollama-probe
 *
 * Probes a configured Ollama instance for installed models via the public
 * `/api/tags` endpoint. Fully dynamic: whatever models the user has pulled
 * locally show up automatically.
 */
import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';
import type { DiscoveredModel, ProviderProbeResult } from '../types';
import { classifyTier, inferCostPer1k } from '../tier-classifier';

const log = createLogger('model-discovery:ollama');

// Warn only on the available→unavailable TRANSITION. The periodic discovery
// re-probes forever, so on a box without Ollama running a per-failure warn
// spams the log every cycle (observed: dozens of identical warns per day).
let lastProbeFailed = false;

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

/**
 * Probe Ollama for available local models.
 *
 * @returns Probe result with all `ollama list`-equivalent entries. / 探索結果
 */
export async function probeOllama(): Promise<ProviderProbeResult> {
  const settings = await prisma.userSettings.findFirst();
  const baseUrl = settings?.ollamaUrl;
  if (!baseUrl) {
    return {
      provider: 'ollama',
      available: false,
      reason: 'userSettings.ollamaUrl が未設定',
      models: [],
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/tags`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return {
        provider: 'ollama',
        available: false,
        reason: `HTTP ${res.status} from ${url}`,
        models: [],
      };
    }
    const json = (await res.json()) as OllamaTagsResponse;
    const tags = (json.models ?? []).map((m) => m.name ?? m.model).filter(Boolean) as string[];
    if (tags.length === 0) {
      lastProbeFailed = false;
      return {
        provider: 'ollama',
        available: true,
        reason: 'インストール済みモデルなし',
        models: [],
      };
    }
    const models: DiscoveredModel[] = tags.map((id) => {
      const tier = classifyTier(id);
      return {
        id,
        provider: 'ollama',
        tier,
        costPer1kTokens: inferCostPer1k(id, tier),
        source: 'http-list',
        label: id,
      };
    });
    lastProbeFailed = false;
    return { provider: 'ollama', available: true, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : err;
    if (lastProbeFailed) {
      log.debug({ err: msg }, 'Ollama probe still failing');
    } else {
      log.warn({ err: msg }, 'Ollama probe failed');
    }
    lastProbeFailed = true;
    return {
      provider: 'ollama',
      available: false,
      reason: 'Ollama API への接続に失敗',
      models: [],
    };
  }
}
