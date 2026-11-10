/**
 * model-discovery/tier-classifier
 *
 * Assigns a `ModelTier` to a model id and an approximate cost per 1K tokens.
 * The model tier table (services/ai/model-tier-table) is the source of truth:
 * a registered id gets the table's tier and price. Only ids the table does not
 * know fall through to the name heuristics below, and their tier is capped at
 * the table's conservative default (standard) — a name that looks like a
 * flagship is not an evaluation.
 *
 * The heuristics are name-pattern based (opus / pro / o1 / mini / flash /
 * haiku / nano …), so an unregistered release still lands in a sane tier for
 * cost estimates until the table is updated.
 */

import {
  capUnregisteredTier,
  costPer1kOf,
  findModelEntry,
  strongerTier,
} from '../model-tier-table/tier-table';
import type { ModelTier } from './types';

/**
 * Classify a model id into a capability tier: the table's tier when the id is
 * registered, otherwise the name heuristic capped at standard.
 *
 * @param modelId - Model identifier returned by a probe. / モデルID
 * @returns Tier to route on. / ルーティングに使うティア
 */
export function classifyTier(modelId: string): ModelTier {
  const entry = findModelEntry(modelId);
  if (entry) return entry.tier;
  // NOTE: Capped since the tier table landed — before it, 'claude-opus-4-8',
  // 'gpt-5' or 'gemini-2.5-pro' were premium on their name alone (追補3).
  return capUnregisteredTier(classifyTierByName(modelId));
}

/**
 * The tier a model ran AS, for statistics over past runs: the table's tier
 * when registered, otherwise the uncapped name heuristic.
 *
 * NOTE: Not capped like classifyTier. The cap is a placement rule for models
 * nobody has evaluated; applied to history it would relabel every past
 * premium run on a now-unlisted id (claude-fable-5, claude-opus-4-x …) as
 * standard, and the evidence that a cheaper tier is "proven" would then be
 * built on premium runs.
 *
 * @param modelId - Model id recorded on the run / 実行記録のモデルID
 * @returns Tier for evidence aggregation / 実績集計用のティア
 */
export function observedTier(modelId: string): ModelTier {
  return findModelEntry(modelId)?.tier ?? classifyTierByName(modelId);
}

/**
 * Name-only tier guess, uncapped. Used for unregistered ids: capped for
 * placement by classifyTier, uncapped for cost estimates (an unregistered
 * flagship still costs like one).
 */
function classifyTierByName(modelId: string): ModelTier {
  const m = modelId.toLowerCase();

  // 1. Local / self-hosted models cost nothing.
  if (/(^|[-/])ollama|llama|mistral|qwen|deepseek|phi-?\d|gemma|local\b|self-hosted/.test(m)) {
    return 'free';
  }

  // 2. Premium markers — flagship reasoning / large-context tiers.
  // `fable|mythos`: Anthropic's Mythos-class tier sits ABOVE Opus.
  // `\bo\d\b` / `gpt-?5\b` carry a `(?!-(?:mini|nano))` guard so small
  // variants ("o3-mini", "gpt-5-nano") fall through to the economy check —
  // the old `o\d-(?:pro|max|preview)?\b` matched with an EMPTY suffix and
  // misclassified "o3-mini" as premium. NOTE: premium must stay checked
  // BEFORE economy — "geMINI" contains "mini", so an economy-first order
  // would swallow every Gemini flagship.
  if (
    /(opus|fable|mythos|claude-3-opus|gpt-?5\b(?!-(?:mini|nano))|\bo\d\b(?!-(?:mini|nano))|2\.5-pro|gemini-?\d(?:\.\d)?-pro|pro-thinking|gpt-4-turbo|gpt-4-vision|premium)/.test(
      m,
    )
  ) {
    return 'premium';
  }

  // 3. Economy markers — small/fast variants. `mini` requires a leading
  // separator so "gemini" (the substring trap above) never matches.
  if (/(haiku|(?:^|[-_.])mini\b|flash|lite|nano|small|tiny|economy|micro|fast\b)/.test(m)) {
    return 'economy';
  }

  // 4. Default = standard tier (sonnet, gpt-4o, gemini-pro, etc.).
  return 'standard';
}

/**
 * USD per 1K tokens (rough avg of input + output) when the provider did not
 * include a price: the table's official price for a registered id, otherwise
 * a tier heuristic. Used as a tiebreaker and for estimates, not for billing.
 *
 * @param modelId - Model identifier. / モデルID
 * @param tier - Tier already classified for this model. / 分類済みティア
 * @returns Estimated USD/1K. / トークン1Kあたり推定単価（USD）
 */
export function inferCostPer1k(modelId: string, tier: ModelTier): number {
  const entry = findModelEntry(modelId);
  const tabled = entry ? costPer1kOf(entry) : null;
  if (tabled !== null) return tabled;
  // An unregistered id's placement tier is capped, its price is not: estimate
  // from the stronger of the given tier and what its name says.
  const priceTier = entry ? tier : strongerTier(tier, classifyTierByName(modelId));
  switch (priceTier) {
    case 'free':
      return 0;
    case 'economy':
      return 0.001;
    case 'standard':
      // gpt-4o-class hovers around $0.008, sonnet around $0.006 — average.
      return 0.006;
    case 'premium': {
      // Mythos-class (fable/mythos) sits ABOVE Opus in Anthropic's actual
      // pricing — must be checked before the opus branch or cheapest()
      // picks fable/mythos as the "cheap premium" option (#797).
      const id = modelId.toLowerCase();
      if (/fable|mythos/.test(id)) return 0.04;
      return id.includes('opus') ? 0.025 : 0.012;
    }
  }
}
