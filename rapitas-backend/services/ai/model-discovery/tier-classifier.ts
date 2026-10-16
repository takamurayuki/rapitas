/**
 * model-discovery/tier-classifier
 *
 * Pure heuristics for assigning a `ModelTier` to a model id and inferring an
 * approximate cost per 1K tokens when the provider does not report one.
 *
 * The rules are name-pattern based so future Anthropic / OpenAI / Google /
 * Ollama models — which all reuse a small vocabulary of marketing labels
 * (opus / pro / o1 / mini / flash / haiku / nano …) — slot into the right
 * tier with no code change. Only when an entirely new naming convention
 * appears does this file need an update.
 */

import type { ModelTier } from './types';

/**
 * Classify a model id into a coarse capability tier using its name.
 *
 * @param modelId - Model identifier returned by a probe. / モデルID
 * @returns Inferred tier. / 推定ティア
 */
export function classifyTier(modelId: string): ModelTier {
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
 * Infer USD per 1K tokens (rough avg of input + output) when the provider did
 * not include a price. Heuristic — used only as a tiebreaker, not for billing.
 *
 * @param modelId - Model identifier. / モデルID
 * @param tier - Tier already classified for this model. / 分類済みティア
 * @returns Estimated USD/1K. / トークン1Kあたり推定単価（USD）
 */
export function inferCostPer1k(modelId: string, tier: ModelTier): number {
  switch (tier) {
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
