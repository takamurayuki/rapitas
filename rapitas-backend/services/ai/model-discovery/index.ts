/**
 * model-discovery
 *
 * Public entry point for the model discovery layer. Runs every probe in
 * parallel, caches the result for a short interval (probes spawn CLIs and
 * hit external APIs — neither belongs in the hot path), and exposes
 * selection helpers used by the SmartModelRouter.
 *
 * The router itself stays free of model id constants: this layer is the
 * only place we acknowledge specific provider behaviors.
 */
import { createLogger } from '../../../config/logger';
import { probeClaude } from './probes/claude-probe';
import { probeGemini } from './probes/gemini-probe';
import { probeOllama } from './probes/ollama-probe';
import { probeOpenAi } from './probes/openai-probe';
import type {
  DiscoveredModel,
  DiscoveryResult,
  ModelTier,
  Provider,
  SelectionContext,
} from './types';

const log = createLogger('model-discovery');

const TIER_FALLBACK: ModelTier[] = ['premium', 'standard', 'economy', 'free'];

/** Two cache slots: default (REST + CLI) and CLI-only. */
const cache = new Map<string, { result: DiscoveryResult; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface DiscoverOptions {
  /**
   * Skip the REST API stage of each probe and rely on CLI introspection only.
   * Useful for "AI agent management" surfaces that intentionally ignore API
   * keys — the user wants to see whether the CLI itself is operational.
   */
  cliOnly?: boolean;
}

/**
 * Run every provider probe and aggregate the result. Cached for 5 minutes
 * to avoid repeatedly spawning CLI subprocesses on hot paths.
 *
 * @param force - When true, bypass the cache and re-probe immediately. / キャッシュを無視
 * @param options - Probe behaviour overrides. / プローブ挙動の上書き
 */
export async function discoverModels(
  force = false,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const now = Date.now();
  const cacheKey = options.cliOnly ? 'cliOnly' : 'default';
  const hit = cache.get(cacheKey);
  if (!force && hit && hit.expiresAt > now) {
    return hit.result;
  }
  const probes = await Promise.all([
    probeClaude(options),
    probeOpenAi(options),
    probeGemini(options),
    probeOllama(),
  ]);
  const flat: DiscoveredModel[] = probes.flatMap((p) => (p.available ? p.models : []));
  const result: DiscoveryResult = {
    fetchedAt: new Date().toISOString(),
    providers: probes,
    models: flat,
  };
  cache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
  log.info(
    `Discovered ${flat.length} models across ${probes.filter((p) => p.available).length}/${probes.length} providers (${cacheKey})`,
  );
  return result;
}

/**
 * Choose the best model for a tier from the discovered set, with automatic
 * downgrade through TIER_FALLBACK when the desired tier has no candidates.
 *
 * Selection priority within a tier:
 *  1. `preferredProvider` if set and available.
 *  2. `preferFree` → free-tier models first.
 *  3. Cheapest `costPer1kTokens` (free wins, REST-discovered prices win
 *     over heuristic estimates because `costPer1kTokens` is real for them).
 *
 * @param ctx - Selection inputs. / 選定条件
 * @returns Picked model and the tier it actually came from, or null when
 *          discovery returned zero models. / 選択結果
 */
export async function selectBestModel(
  ctx: SelectionContext,
): Promise<{ model: DiscoveredModel; tier: ModelTier } | null> {
  const { models } = await discoverModels();
  if (models.length === 0) return null;

  // Drop excluded providers up-front so cross-provider review and any future
  // user-driven blacklist work uniformly across tiers.
  const excludeSet = new Set(ctx.excludeProviders ?? []);
  const eligible = excludeSet.size ? models.filter((m) => !excludeSet.has(m.provider)) : models;
  if (eligible.length === 0) {
    // Exclusions made the pool empty — fall back to the unfiltered list so
    // execution does not crash on a bad config.
    log.warn('selectBestModel: exclusion list emptied the pool, ignoring it');
    return selectBestModel({ ...ctx, excludeProviders: [] });
  }

  const startIdx = TIER_FALLBACK.indexOf(ctx.desiredTier);
  for (let i = Math.max(0, startIdx); i < TIER_FALLBACK.length; i++) {
    const tier = TIER_FALLBACK[i];
    const candidates = eligible.filter((m) => m.tier === tier);
    if (candidates.length === 0) continue;
    const picked = pickPreferred(candidates, ctx);
    return { model: picked, tier };
  }
  // No tier had any candidates — surface anything we found.
  const picked = pickPreferred(eligible, ctx);
  return { model: picked, tier: picked.tier };
}

/** Apply preferred-provider / cost preferences to a candidate list. */
function pickPreferred(candidates: DiscoveredModel[], ctx: SelectionContext): DiscoveredModel {
  if (ctx.preferredProvider) {
    const fromPreferred = candidates.filter((m) => m.provider === ctx.preferredProvider);
    if (fromPreferred.length > 0) {
      return cheapest(fromPreferred);
    }
  }
  if (ctx.preferFree) {
    const free = candidates.filter((m) => (m.costPer1kTokens ?? 0) === 0);
    if (free.length > 0) return free[0];
  }
  return cheapest(candidates);
}

function cheapest(list: DiscoveredModel[]): DiscoveredModel {
  return [...list].sort(
    (a, b) => (a.costPer1kTokens ?? Infinity) - (b.costPer1kTokens ?? Infinity),
  )[0];
}

/** Convenience: just the set of providers currently usable. */
export async function getAvailableProviders(): Promise<Set<Provider>> {
  const { providers } = await discoverModels();
  return new Set(providers.filter((p) => p.available).map((p) => p.provider));
}

/** Force the cache to clear — useful from admin/test endpoints. */
export function invalidateModelDiscoveryCache(): void {
  cache.clear();
}

export type { DiscoveredModel, DiscoveryResult, ModelTier, Provider, SelectionContext };
