/**
 * juror-cli-cooldown
 *
 * Turns a juror's or verifier's failed auxiliary-CLI call into a provider
 * cooldown, so the next review re-plans its seats around a vendor that is out
 * of quota or logged out (routing2b; before this only the executor's
 * failures ever produced a cooldown). Not responsible for asking the seat or
 * for the verdict — the seat still reports 'unknown' as before.
 *
 * Rules (owner decision 4, 2026-11-11):
 * - Only quota and auth failures cool a vendor. rate_limit / transient /
 *   timeouts do not: the cooldown table is shared with executor routing, and
 *   a non-Claude rate_limit escalates to 6 hours after three in a row — far
 *   too much for one throttled review call.
 * - The vendor is the CLI that was actually called (the error's `vendor`),
 *   never the classifier's guess: "you've hit your usage limit" is worded the
 *   same by Claude and Codex.
 * - Only auxiliary-CLI errors count (ClaudeCliUnavailableError /
 *   CodexCliUnavailableError). Anything else carries no trustworthy vendor.
 */
import { createLogger } from '../../../config/logger';
import { classifyAgentError } from '../../ai/agent-error-classifier';
import {
  markProviderCooldown,
  type CooldownReason,
  type Provider,
} from '../../ai/provider-cooldown';

const log = createLogger('verification:juror-cli-cooldown');

/** Error names the auxiliary CLI providers throw (cli-errors.ts). */
const AUX_CLI_ERROR_NAMES = new Set(['ClaudeCliUnavailableError', 'CodexCliUnavailableError']);

const PROVIDER_OF_VENDOR: Record<string, Provider> = { anthropic: 'claude', openai: 'openai' };

/** Reasons that may cool a vendor after an auxiliary call. */
const COOLING_REASONS: ReadonlySet<CooldownReason> = new Set(['quota', 'auth']);

/** What was recorded, for the caller's log line. */
export interface JurorCooldownOutcome {
  provider: Provider;
  reason: CooldownReason;
  resetAt?: Date;
}

function auxVendorOf(err: unknown): string | null {
  if (!(err instanceof Error) || !AUX_CLI_ERROR_NAMES.has(err.name)) return null;
  const vendor = (err as Error & { vendor?: unknown }).vendor;
  return typeof vendor === 'string' && vendor in PROVIDER_OF_VENDOR ? vendor : null;
}

/**
 * Cool the vendor behind a failed seat call when the failure is quota/auth.
 * Never throws.
 *
 * @param err - What the call rejected with / 呼び出しの失敗
 * @param model - The seat's model, kept on the cooldown entry / 席のモデル
 * @returns The cooldown recorded, or null when none applies / 記録した cooldown
 */
export function coolVendorAfterJurorFailure(
  err: unknown,
  model: string,
): JurorCooldownOutcome | null {
  try {
    const vendor = auxVendorOf(err);
    if (!vendor) return null;
    const provider = PROVIDER_OF_VENDOR[vendor];
    const message = (err as Error).message;
    const classified = classifyAgentError(message, { hint: provider });
    if (!classified || !COOLING_REASONS.has(classified.reason)) return null;
    markProviderCooldown(provider, classified.reason, classified.resetAt, {
      model,
      message: message.slice(0, 300),
    });
    log.warn(
      { provider, reason: classified.reason, model },
      '[adversarial-review] Auxiliary CLI failure put the vendor in cooldown',
    );
    return { provider, reason: classified.reason, resetAt: classified.resetAt };
  } catch (error) {
    log.warn({ error }, 'Juror failure could not be classified for cooldown');
    return null;
  }
}
