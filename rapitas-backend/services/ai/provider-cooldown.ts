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

const log = {
  warn: (data: unknown, message: string) => console.warn(message, data),
};

export type { Provider };

export type CooldownReason = 'quota' | 'rate_limit' | 'auth' | 'transient';

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
};

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
  const until = resetAt ? resetAt.getTime() : Date.now() + DEFAULT_DURATION_MS[reason];

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

/** For tests — wipe everything. */
export function __resetCooldowns(): void {
  cooldowns.clear();
}
