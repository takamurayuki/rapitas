/**
 * Provider Cooldown Registry
 *
 * In-memory store of which providers are temporarily unavailable due to
 * quota/rate-limit/auth errors. Smart Model Router consults this to skip
 * cooling providers automatically; the orchestrator's fallback retry path
 * also reads this when it needs to pick an alternative model.
 *
 * Data lives in-process — for desktop/single-process this is sufficient.
 * If we ever scale horizontally we can swap the storage for Redis without
 * touching call sites.
 */

import type { Provider } from './model-discovery/types';
import { createLogger } from '../../config/logger';

// NOTE: Use the shared pino logger, not a console shim (the no-console lint error
// failed project-wide `bun run lint` and blocked auto-run tasks gated on it).
const log = createLogger('ai:provider-cooldown');

export type { Provider };

export type CooldownReason = 'quota' | 'rate_limit' | 'auth' | 'transient' | 'model_unavailable';

interface CooldownEntry {
  provider: Provider;
  reason: CooldownReason;
  /** Epoch ms when the provider becomes usable again. */
  until: number;
  /** Optional model that triggered the cooldown (informational). */
  model?: string;
  message?: string;
}

const cooldowns = new Map<Provider, CooldownEntry>();

/** Default cooldown durations per reason class, in milliseconds. */
const DEFAULT_DURATION_MS: Record<CooldownReason, number> = {
  quota: 60 * 60 * 1000, // 1 hour — usage caps usually reset hourly/daily
  rate_limit: 60 * 1000, // 1 minute — short-window throttles
  auth: 5 * 60 * 1000, // 5 minutes — give the user time to re-login
  transient: 30 * 1000, // 30 seconds — flaky network etc.
  model_unavailable: 60 * 1000, // 1 minute — provider may temporarily not support a model
};

/** Consecutive-failure streak tracked per provider+reason (escalation input). */
export interface FailureStreak {
  provider: Provider;
  reason: CooldownReason;
  /** Consecutive failures inside the escalation window. */
  count: number;
  /** Epoch ms of the most recent failure. */
  lastFailureAt: number;
}

// Keyed `${provider}:${reason}` so claude/gemini and rate_limit/quota streaks
// never contaminate each other.
const failureStreaks = new Map<string, FailureStreak>();

/**
 * Read a positive finite integer from an env var, falling back on the default
 * when unset or malformed (NaN/zero/negative must never poison timing math).
 * Read lazily at call time so tests can tune thresholds via process.env.
 */
function envPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Consecutive rate_limit failures that trigger the long cooldown. */
function escalationThreshold(): number {
  return envPositiveNumber('RAPITAS_PROVIDER_ESCALATION_THRESHOLD', 3);
}

/** Long-cooldown duration applied once the threshold is reached (default 6h). */
function escalationCooldownMs(): number {
  return envPositiveNumber('RAPITAS_PROVIDER_ESCALATION_COOLDOWN_MS', 6 * 60 * 60 * 1000);
}

/** Failures further apart than this window are not "consecutive" (default 30m). */
function escalationWindowMs(): number {
  return envPositiveNumber('RAPITAS_PROVIDER_ESCALATION_WINDOW_MS', 30 * 60 * 1000);
}

/**
 * Record that a provider is temporarily unusable.
 *
 * @param provider - Provider name / プロバイダー
 * @param reason - Why it failed (chooses default cooldown duration)
 * @param resetAt - Explicit reset time if the error response provided one
 */
export function markProviderCooldown(
  provider: Provider,
  reason: CooldownReason,
  resetAt?: Date,
  context?: { model?: string; message?: string },
): void {
  const now = Date.now();
  let until = resetAt ? resetAt.getTime() : now + DEFAULT_DURATION_MS[reason];

  // Escalation (task #633): consecutive rate_limit failures promote a provider
  // to a long cooldown, stopping the "pick gemini → instant 429 → 60s later
  // pick gemini again" churn. claude is deliberately exempt — it is the
  // subscription main path and must keep its current short-cooldown behavior.
  // An explicit resetAt is authoritative upstream info, so it bypasses
  // escalation (and does not count toward the streak).
  if (reason === 'rate_limit' && provider !== 'claude' && !resetAt) {
    const key = `${provider}:${reason}`;
    const prev = failureStreaks.get(key);
    const isConsecutive = prev !== undefined && now - prev.lastFailureAt <= escalationWindowMs();
    const count = isConsecutive ? prev.count + 1 : 1;
    failureStreaks.set(key, { provider, reason, count, lastFailureAt: now });

    if (count >= escalationThreshold()) {
      until = Math.max(until, now + escalationCooldownMs());
      log.warn(
        {
          provider,
          reason,
          streak: count,
          untilIso: new Date(until).toISOString(),
        },
        'Provider escalated to long cooldown after consecutive failures',
      );
    }
  }

  const existing = cooldowns.get(provider);
  // Don't shorten an existing cooldown — pick the later expiry.
  if (existing && existing.until > until) return;

  cooldowns.set(provider, {
    provider,
    reason,
    until,
    model: context?.model,
    message: context?.message,
  });

  log.warn(
    {
      provider,
      reason,
      untilIso: new Date(until).toISOString(),
      model: context?.model,
    },
    'Provider placed in cooldown',
  );
}

/** True if the provider is currently cooling down. */
export function isProviderInCooldown(provider: Provider): boolean {
  const entry = cooldowns.get(provider);
  if (!entry) return false;
  if (entry.until > Date.now()) return true;
  // Expired — clean up so callers see fresh state.
  cooldowns.delete(provider);
  return false;
}

/** Snapshot of all currently-active cooldowns (used by status APIs / UI). */
export function listActiveCooldowns(): CooldownEntry[] {
  const now = Date.now();
  const active: CooldownEntry[] = [];
  for (const [provider, entry] of cooldowns) {
    if (entry.until > now) active.push(entry);
    else cooldowns.delete(provider);
  }
  return active;
}

/** Manually clear a provider's cooldown — e.g. after the user re-authenticates. */
export function clearCooldown(provider: Provider): void {
  cooldowns.delete(provider);
}

/**
 * Record a successful execution on a provider: clears its failure streaks and
 * lifts any active cooldown ("success releases the escalation", task #633).
 *
 * @param provider - Provider that just completed successfully / 成功したプロバイダー
 */
export function recordProviderSuccess(provider: Provider): void {
  let cleared = false;
  for (const key of failureStreaks.keys()) {
    if (key.startsWith(`${provider}:`)) {
      failureStreaks.delete(key);
      cleared = true;
    }
  }
  if (cooldowns.delete(provider)) cleared = true;
  // Only log when state actually changed — every completed execution calls
  // this, and an unconditional line would flood the log.
  if (cleared) {
    log.info({ provider }, 'Provider cooldown/failure streak cleared after success');
  }
}

/**
 * Snapshot of current (non-stale) failure streaks, for status APIs / logs.
 * Entries older than the escalation window are pruned — they no longer count
 * as "consecutive" so surfacing them would misreport escalation proximity.
 *
 * @returns Active failure streaks / 現在有効な連続失敗ストリーク
 */
export function listFailureStreaks(): FailureStreak[] {
  const now = Date.now();
  const active: FailureStreak[] = [];
  for (const [key, streak] of failureStreaks) {
    if (now - streak.lastFailureAt <= escalationWindowMs()) active.push({ ...streak });
    else failureStreaks.delete(key);
  }
  return active;
}

/**
 * Infer the canonical Provider from a model id reported by CLI usage JSON
 * (e.g. `claude-sonnet-4-5` → claude, `gemini-2.5-pro` → gemini).
 *
 * @param modelName - Model id from usage reporting / 使用量報告のモデルID
 * @returns Matching provider, or null when unrecognized / 不明なら null
 */
export function inferProviderFromModelName(modelName: string | null | undefined): Provider | null {
  if (!modelName) return null;
  const m = modelName.toLowerCase();
  if (/claude|sonnet|opus|haiku|fable|mythos/.test(m)) return 'claude';
  if (/gemini/.test(m)) return 'gemini';
  if (/gpt|codex|^o\d\b/.test(m)) return 'openai';
  if (/llama|ollama|qwen|deepseek|mistral/.test(m)) return 'ollama';
  return null;
}

/** For tests — wipe everything (cooldowns and failure streaks). */
export function __resetCooldowns(): void {
  cooldowns.clear();
  failureStreaks.clear();
}
