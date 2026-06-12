/**
 * local-model-selector
 *
 * Picks the best local (Ollama) model actually installed on the machine instead
 * of hardcoding a single name. Prefers a capable ~3B instruct model (the sweet
 * spot for a normal CPU PC), falling back to whatever smaller model is present.
 * Lets users raise quality just by `ollama pull`-ing a bigger model — no code
 * change needed.
 */
import { getLocalLLMStatus } from './local-llm-manager';

/**
 * Preference order, most-capable → smallest. Matched as a case-insensitive
 * prefix against installed model names (so `qwen2.5:3b` also matches
 * `qwen2.5:3b-instruct-q4_K_M`). Bare names (e.g. `llama3.2`) match any tag.
 */
const PREFERENCE: readonly string[] = [
  'qwen2.5:7b',
  'llama3.1:8b',
  'llama3:8b',
  'qwen2.5:3b',
  'llama3.2:3b',
  'llama3.2', // Ollama's default llama3.2 is 3B
  'gemma2:2b',
  'phi3.5',
  'qwen2.5:1.5b',
  'llama3.2:1b',
  'qwen2.5:0.5b',
];

/** Used when nothing is installed / discovery fails. */
const FALLBACK_MODEL = 'qwen2.5:0.5b';

/**
 * Chooses the most capable installed model from the preference list.
 *
 * @param available - Installed model names (from Ollama) / インストール済みモデル名
 * @returns Best matching model, or the first available / 最良モデル
 */
export function pickBestLocalModel(available: string[]): string {
  if (available.length === 0) return FALLBACK_MODEL;
  const lower = available.map((m) => m.toLowerCase());
  for (const pref of PREFERENCE) {
    const idx = lower.findIndex((m) => m.startsWith(pref));
    if (idx >= 0) return available[idx];
  }
  return available[0];
}

let cache: { model: string; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * Resolves the best local model to use right now (cached briefly). Falls back
 * to a tiny model when no local LLM is available.
 *
 * @returns Best available local model name / 利用可能な最良ローカルモデル名
 */
export async function getBestLocalModel(): Promise<string> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.model;
  const status = await getLocalLLMStatus().catch(() => null);
  const model =
    status && status.available && status.models.length > 0
      ? pickBestLocalModel(status.models)
      : FALLBACK_MODEL;
  cache = { model, at: Date.now() };
  return model;
}
