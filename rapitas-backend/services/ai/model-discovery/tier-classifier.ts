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
  if (
    /(opus|claude-3-opus|gpt-?5\b|o\d-(?:pro|max|preview)?\b|2\.5-pro|gemini-?\d-pro|pro-thinking|gpt-4-turbo|gpt-4-vision|premium)/.test(
      m,
    )
  ) {
    return 'premium';
  }

  // 3. Economy markers — small/fast variants. Checked BEFORE standard so that
  // names like "gpt-4o-mini" land in economy rather than standard ("4o").
  if (/(haiku|mini|flash|lite|nano|small|tiny|economy|micro|fast\b)/.test(m)) {
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
    case 'premium':
      return modelId.toLowerCase().includes('opus') ? 0.025 : 0.012;
  }
}
