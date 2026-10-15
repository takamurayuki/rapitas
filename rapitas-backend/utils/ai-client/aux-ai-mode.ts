/**
 * aux-ai-mode
 *
 * Resolves the routing mode for auxiliary AI helper calls from the
 * environment. Kept apart from the ai-client barrel so consumers that only
 * need the mode (phase-critic's key gate) can import it without the barrel:
 * many tests replace the barrel with a fixed export list, and a new barrel
 * export broke every one of them at load time (2026-09-25, critic-lessons).
 */

export type AuxAiMode = 'cli' | 'api' | 'off';

/**
 * Routing mode for auxiliary AI helper calls (naming, spec derivation, memory
 * upkeep, reviews, chat, …). Controls whether these run through the Claude Code
 * CLI (subscription, no per-token billing), the paid Anthropic API, or are
 * disabled entirely.
 *
 * - `cli` (default): delegate to the subscription-backed CLI. No paid API is hit.
 * - `api`: use the paid provider (legacy behavior / emergency escape hatch).
 * - `off`: disable auxiliary AI — callers degrade gracefully.
 *
 * @returns The resolved mode / 解決されたモード
 */
export function getAuxAiMode(): AuxAiMode {
  const v = (process.env.RAPITAS_AUX_AI || 'cli').toLowerCase();
  return v === 'api' || v === 'off' ? v : 'cli';
}
