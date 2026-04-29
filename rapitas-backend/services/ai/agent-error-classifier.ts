/**
 * Agent Error Classifier
 *
 * Translates provider-specific failure messages (CLI stderr, exception
 * payloads) into a normalized category so the fallback retry path can
 * decide whether to switch providers, and how long to cool down the
 * failed one.
 *
 * Patterns are intentionally lenient — false positives just trigger an
 * earlier retry on a different provider, which is acceptable. False
 * negatives waste a retry against a quota-exhausted provider, which is
 * the worse outcome we are guarding against.
 */

import type { CooldownReason, Provider } from './provider-cooldown';

export interface ClassifiedError {
  /** Recommended cooldown reason — controls how long to shun the provider. */
  reason: CooldownReason;
  /** Provider implicated in the failure. */
  provider: Provider;
  /** Reset time parsed from the message (e.g. "try again at 1:19 PM"). */
  resetAt?: Date;
  /** True when retrying with a different model/provider is worth doing. */
  retryWithFallback: boolean;
  /** Original raw message (truncated) for logging / UI display. */
  rawMessage: string;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Parse a "try again at HH:MM AM/PM" hint into an absolute Date in the
 * future. Falls back to undefined if no hint is present or parseable.
 */
function parseTryAgainAt(message: string): Date | undefined {
  // e.g. "try again at 1:19 PM."  or  "Resets at 14:30 UTC"
  const m = message.match(/try again at\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/);
  if (!m) return undefined;
  const hour12 = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = m[3]?.toUpperCase();

  const now = new Date();
  const target = new Date(now);
  let hour = hour12;
  if (ampm === 'PM' && hour12 < 12) hour += 12;
  if (ampm === 'AM' && hour12 === 12) hour = 0;
  target.setHours(hour, minute, 0, 0);
  // If the target time has already passed today, assume tomorrow.
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

interface PatternRule {
  /** Provider this rule attributes failures to. */
  provider: Provider;
  /** Cooldown reason class. */
  reason: CooldownReason;
  /** Substring (case-insensitive) or RegExp to match. */
  pattern: RegExp;
}

// Order matters: more specific patterns first so they win.
const RULES: PatternRule[] = [
  // --- ChatGPT / Codex CLI ---
  {
    provider: 'openai',
    reason: 'quota',
    pattern: /you'?ve hit your usage limit/i,
  },
  {
    provider: 'openai',
    reason: 'quota',
    pattern: /codex\/settings\/usage/i,
  },
  { provider: 'openai', reason: 'quota', pattern: /purchase more credits/i },
  {
    provider: 'openai',
    // Require an OpenAI/Codex-specific marker so this doesn't shadow the
    // Anthropic rate_limit rule below.
    reason: 'rate_limit',
    pattern: /(openai|codex|chatgpt).*rate[ _-]?limit/i,
  },
  { provider: 'openai', reason: 'auth', pattern: /not (authenticated|logged in)/i },

  // --- Anthropic / Claude Code CLI ---
  {
    provider: 'claude',
    reason: 'quota',
    pattern: /credit[ _]?balance[ _]?too[ _]?low/i,
  },
  // Match Anthropic's specific error name, not the generic phrase, so we
  // don't false-positive on prose like "implements rate limiting".
  { provider: 'claude', reason: 'rate_limit', pattern: /rate_limit_error/i },
  {
    provider: 'claude',
    reason: 'rate_limit',
    pattern: /anthropic api error.*overloaded/i,
  },
  { provider: 'claude', reason: 'auth', pattern: /invalid api key/i },
  {
    provider: 'claude',
    reason: 'auth',
    pattern: /authentication.*expired|token.*expired/i,
  },

  // --- Google / Gemini CLI ---
  { provider: 'gemini', reason: 'quota', pattern: /resource_exhausted/i },
  { provider: 'gemini', reason: 'quota', pattern: /quota exceeded/i },
  {
    provider: 'gemini',
    reason: 'rate_limit',
    pattern: /(too many requests|429)/i,
  },
  {
    provider: 'gemini',
    reason: 'auth',
    pattern: /api key (not valid|invalid|expired)/i,
  },

  // --- Ollama (local) ---
  {
    provider: 'ollama',
    reason: 'transient',
    pattern: /connection refused|econnrefused/i,
  },
  { provider: 'ollama', reason: 'transient', pattern: /model.*not.*found/i },
];

export interface ClassifyOptions {
  /** Optional provider hint (e.g. the agent we tried) used as a fallback. */
  hint?: Provider;
  /**
   * Strict mode — only explicit named rules count, the bare-keyword
   * heuristics are skipped. Use this when validating the output of a
   * SUCCESSFUL run to avoid false positives on innocent words like
   * "credit", "rate limit" (e.g. when the agent is reviewing code that
   * implements rate limiting). The lenient mode is fine when we already
   * know the agent failed and just want to attribute it to a provider.
   */
  strict?: boolean;
}

/**
 * Classify an error message / output blob.
 *
 * @param input - Raw message, stderr, or stringified exception
 * @param hintOrOptions - Provider hint (legacy) or full ClassifyOptions
 * @returns Classification or null if the input is plainly not an AI error
 */
export function classifyAgentError(
  input: string,
  hintOrOptions?: Provider | ClassifyOptions,
): ClassifiedError | null {
  const opts: ClassifyOptions =
    typeof hintOrOptions === 'string' || hintOrOptions === undefined
      ? { hint: hintOrOptions }
      : hintOrOptions;
  const { hint, strict = false } = opts;

  const message = (input ?? '').slice(0, 4000);
  if (!message.trim()) return null;

  for (const rule of RULES) {
    if (rule.pattern.test(message)) {
      return {
        reason: rule.reason,
        provider: rule.provider,
        resetAt: rule.reason === 'quota' ? parseTryAgainAt(message) : undefined,
        retryWithFallback: rule.reason !== 'auth',
        rawMessage: message,
      };
    }
  }

  if (strict) return null;

  // Strong quota signal: the phrase "try again at HH:MM" is virtually
  // always a quota/throttle response. Match it even without ERROR context.
  if (/try again at\s+\d{1,2}:\d{2}/i.test(message)) {
    return {
      reason: 'quota',
      provider: hint ?? 'claude',
      resetAt: parseTryAgainAt(message),
      retryWithFallback: true,
      rawMessage: message,
    };
  }

  // Last-resort: HTTP-style status hints commonly present in tool output.
  // Only fire when the keyword sits next to an ERROR/FATAL marker so we
  // don't trip on "implements rate limiting" or similar prose.
  const errorContext = /(^|\n)\s*(ERROR|FATAL|Exception|Traceback)/i.test(message);
  if (errorContext) {
    if (/\b(429|rate[_ ]?limit(ed|ing)?)\b/i.test(message)) {
      return {
        reason: 'rate_limit',
        provider: hint ?? 'claude',
        retryWithFallback: true,
        rawMessage: message,
      };
    }
    // Bare "credit" alone is too noisy — require explicit credit *balance*
    // / *exhausted* / *exceeded* phrasing.
    if (
      /\b(quota exceeded|usage limit|credit balance|out of credits|insufficient credit)\b/i.test(
        message,
      )
    ) {
      return {
        reason: 'quota',
        provider: hint ?? 'claude',
        resetAt: parseTryAgainAt(message),
        retryWithFallback: true,
        rawMessage: message,
      };
    }
  }

  return null;
}

/** Convenience helper for tests. */
export const __internal = { parseTryAgainAt, HOUR_MS };
