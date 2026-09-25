/**
 * Prompt Size Guard
 *
 * Pre-flight size check for prompts sent to `claude --print`, so an oversized prompt is
 * trimmed client-side instead of failing with "Prompt is too long (limit 200000)".
 * It does not split work across calls; callers that need completeness must chunk themselves.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('ai-client:prompt-size-guard');

/**
 * Default ceiling in estimated tokens. The CLI adds system prompt and tool definitions on top
 * of the prompt (a 127k conversation became a 363k request in the 2026-09-21 incident), so this
 * sits well under the 200k hard limit.
 */
export const DEFAULT_MAX_PROMPT_TOKENS = 150_000;

const ENV_KEY = 'RAPITAS_AUX_AI_MAX_PROMPT_TOKENS';

// Chars-per-token ratio of 2 deliberately over-counts Latin text and roughly matches Japanese.
const CHARS_PER_TOKEN = 2;

/**
 * Estimate the token count of a text.
 *
 * @param text - Text to measure / 対象テキスト
 * @returns Estimated tokens (ceil(length / 2)) / トークン見積り
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Resolve the prompt token ceiling, honouring RAPITAS_AUX_AI_MAX_PROMPT_TOKENS.
 *
 * @returns Positive integer ceiling; the default when the override is unset or invalid / 上限値
 */
export function getMaxPromptTokens(): number {
  const raw = process.env[ENV_KEY];
  if (raw === undefined) return DEFAULT_MAX_PROMPT_TOKENS;
  if (/^[1-9]\d*$/.test(raw.trim())) return Number(raw.trim());
  log.warn({ value: raw }, `Invalid ${ENV_KEY}; using default ${DEFAULT_MAX_PROMPT_TOKENS}`);
  return DEFAULT_MAX_PROMPT_TOKENS;
}

/**
 * Trim a prompt to the token ceiling by dropping its tail, logging a warning when it does.
 *
 * The head is kept because instructions precede variable data in our prompts.
 *
 * @param prompt - Combined prompt text / 結合済みプロンプト
 * @param opts - maxTokens overrides the ceiling; label tags the warning / 上限・ログ用ラベル
 * @returns The prompt unchanged if within the ceiling, otherwise its head / 切り詰め後のプロンプト
 */
export function guardPromptSize(
  prompt: string,
  opts: { maxTokens?: number; label?: string } = {},
): string {
  const maxTokens = opts.maxTokens ?? getMaxPromptTokens();
  const estimated = estimateTokens(prompt);
  if (estimated <= maxTokens) return prompt;

  const trimmed = prompt.slice(0, maxTokens * CHARS_PER_TOKEN);
  log.warn(
    {
      label: opts.label,
      estimatedTokens: estimated,
      maxTokens,
      droppedChars: prompt.length - trimmed.length,
    },
    'Prompt exceeded size limit; tail truncated before calling Claude CLI',
  );
  return trimmed;
}
