/**
 * RetryPolicy
 *
 * Centralises env-var loading for agent retry configuration.
 * All other retry modules import from here rather than reading process.env directly.
 *
 * Env var reference (all optional — defaults preserve pre-existing behaviour):
 *   Global fallback (hook-less path in agent-retry.ts):
 *     RAPITAS_RETRY_MAX           — max retry count      (default: 3)
 *     RAPITAS_RETRY_DELAY_MS      — base delay in ms     (default: 3000)
 *     RAPITAS_RETRY_UPPER_BOUND   — hard retry ceiling   (default: 10)
 *
 *   Per-error-type overrides (for DefaultErrorHandler strategies):
 *     RAPITAS_RETRY_<TYPE>_MAX          — maxRetries
 *     RAPITAS_RETRY_<TYPE>_DELAY_MS     — initialDelayMs
 *     RAPITAS_RETRY_<TYPE>_MAX_DELAY_MS — maxDelayMs
 *     RAPITAS_RETRY_<TYPE>_BACKOFF      — backoffMultiplier (float, min 1)
 *
 *   Where <TYPE> is the AgentErrorType in UPPER_SNAKE_CASE, e.g.
 *     RATE_LIMIT, NETWORK, TIMEOUT, AUTHENTICATION, EXECUTION,
 *     RESOURCE, INTERNAL, CONFIGURATION, VALIDATION, PERMISSION
 */

import type { AgentErrorType } from './interfaces';

/** Global fallback retry policy (used by the hook-less path in agent-retry.ts). */
export interface RetryPolicy {
  /** Maximum number of retry attempts. */
  maxRetries: number;
  /** Base delay in milliseconds between retries. */
  delayMs: number;
  /** Hard upper bound on retries regardless of other configuration. */
  upperBound: number;
}

/** Per-error-type retry strategy fields that can be overridden via env vars. */
export interface RetryStrategyOverride {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

/**
 * Parses an integer environment variable.
 * Returns `defaultValue` when the variable is absent, empty, or non-numeric.
 * Clamps negative values to 0; optionally clamps to a minimum (useful for multipliers).
 *
 * @param name - Environment variable name / 環境変数名
 * @param defaultValue - Fallback value / デフォルト値
 * @param minValue - Minimum allowed value (default 0) / 最小許容値（既定0）
 * @returns Parsed integer / パース済み整数
 */
export function parseIntEnv(name: string, defaultValue: number, minValue = 0): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(minValue, parsed);
}

/**
 * Parses a float environment variable (for backoff multipliers).
 * Returns `defaultValue` when absent, empty, or non-numeric.
 * Clamps to minimum 1 to prevent zero/sub-1 multipliers that collapse delays.
 *
 * @param name - Environment variable name / 環境変数名
 * @param defaultValue - Fallback value / デフォルト値
 * @returns Parsed float, clamped ≥ 1 / パース済みfloat（最小1）
 */
export function parseFloatEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseFloat(raw);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(1, parsed);
}

/**
 * Returns the global retry policy by reading env vars.
 * Called per-invocation (lazy) so tests can override process.env between calls.
 *
 * @returns Global retry policy / グローバルリトライポリシー
 */
export function getGlobalRetryPolicy(): RetryPolicy {
  return {
    maxRetries: parseIntEnv('RAPITAS_RETRY_MAX', 3),
    delayMs: parseIntEnv('RAPITAS_RETRY_DELAY_MS', 3000),
    upperBound: parseIntEnv('RAPITAS_RETRY_UPPER_BOUND', 10),
  };
}

/**
 * All supported AgentErrorType values in declaration order.
 * Used to iterate over env var keys without hand-rolling the list.
 */
const AGENT_ERROR_TYPES: AgentErrorType[] = [
  'configuration',
  'authentication',
  'rate_limit',
  'timeout',
  'network',
  'execution',
  'validation',
  'resource',
  'permission',
  'internal',
];

/**
 * Maps an AgentErrorType to the UPPER_SNAKE_CASE env var segment.
 * e.g. "rate_limit" → "RATE_LIMIT"
 */
function toEnvKey(type: AgentErrorType): string {
  return type.toUpperCase().replace(/-/g, '_');
}

/**
 * Returns per-error-type strategy overrides derived from env vars.
 * Only keys that are explicitly set are included; absent keys are omitted so
 * DefaultErrorHandler can merge them against its own defaults.
 *
 * @returns Partial overrides per error type / エラー種別ごとの部分的オーバーライド
 */
export function getErrorTypeStrategyOverrides(): Partial<
  Record<AgentErrorType, RetryStrategyOverride>
> {
  const overrides: Partial<Record<AgentErrorType, RetryStrategyOverride>> = {};

  for (const type of AGENT_ERROR_TYPES) {
    const key = toEnvKey(type);
    const override: RetryStrategyOverride = {};
    let hasOverride = false;

    const maxEnv = `RAPITAS_RETRY_${key}_MAX`;
    if (process.env[maxEnv] !== undefined) {
      override.maxRetries = parseIntEnv(maxEnv, 0);
      hasOverride = true;
    }

    const delayEnv = `RAPITAS_RETRY_${key}_DELAY_MS`;
    if (process.env[delayEnv] !== undefined) {
      override.initialDelayMs = parseIntEnv(delayEnv, 0);
      hasOverride = true;
    }

    const maxDelayEnv = `RAPITAS_RETRY_${key}_MAX_DELAY_MS`;
    if (process.env[maxDelayEnv] !== undefined) {
      override.maxDelayMs = parseIntEnv(maxDelayEnv, 0);
      hasOverride = true;
    }

    const backoffEnv = `RAPITAS_RETRY_${key}_BACKOFF`;
    if (process.env[backoffEnv] !== undefined) {
      override.backoffMultiplier = parseFloatEnv(backoffEnv, 1);
      hasOverride = true;
    }

    if (hasOverride) {
      overrides[type] = override;
    }
  }

  return overrides;
}
