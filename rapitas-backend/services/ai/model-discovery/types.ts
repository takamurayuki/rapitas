/**
 * model-discovery/types
 *
 * Shared types for the dynamic model discovery layer. Probes return these
 * shapes; the SmartModelRouter consumes them.
 */

/** A configured AI provider that may host one or more models. */
export type Provider = 'claude' | 'openai' | 'gemini' | 'ollama';

/** Coarse capability/cost tier inferred from a model id. */
export type ModelTier = 'premium' | 'standard' | 'economy' | 'free';

/** A single model surfaced by a provider probe. */
export interface DiscoveredModel {
  /** Canonical id used when invoking the model (CLI alias or full version id). */
  id: string;
  provider: Provider;
  tier: ModelTier;
  /**
   * USD per 1K tokens (rough average of input + output). When the probe can
   * not infer a price, leave undefined so the consumer can apply heuristics.
   */
  costPer1kTokens?: number;
  /** Where this entry came from — useful for diagnostics. */
  source: 'cli-alias' | 'rest-api' | 'http-list';
  /** Display label for UI (e.g. "Sonnet (latest)"). */
  label?: string;
}

/** Result returned by a single provider probe. */
export interface ProviderProbeResult {
  provider: Provider;
  /** True when the probe successfully reached the provider. */
  available: boolean;
  /** Why the provider is unavailable, when `available === false`. */
  reason?: string;
  /** All models the provider exposes (empty when unavailable). */
  models: DiscoveredModel[];
}

/** Aggregated discovery result across every provider. */
export interface DiscoveryResult {
  fetchedAt: string;
  providers: ProviderProbeResult[];
  /** Flat list across all providers, only models marked available. */
  models: DiscoveredModel[];
}

/** Selection input used by the router. */
export interface SelectionContext {
  /** Required tier (router falls back through the hierarchy if empty). */
  desiredTier: ModelTier;
  /** When true, prefer free/local options over paid ones in the same tier. */
  preferFree?: boolean;
  /** When set, prefer this provider when several are tied. */
  preferredProvider?: Provider;
  /**
   * Providers to remove from the candidate pool before selection. Used to
   * realise "cross-provider review" — the orchestrator passes the upstream
   * phase's provider here so reviewer/verifier picks a different family,
   * mitigating the self-evaluation bias common across LLM-as-judge research.
   */
  excludeProviders?: Provider[];
}
