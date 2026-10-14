/**
 * Canary Service
 *
 * Handles a hit on a canary URL: matches the token, appends the detection to
 * the dedicated log and raises one aggregated in-app notification per window.
 * It is not responsible for issuing tokens (canary-ledger.ts) or HTTP wiring.
 */
import { createLogger } from '../../config/logger';
import { appendCanaryHit } from './canary-event-log';
import {
  claimNotificationWindow,
  findToken,
  loadLedger,
  releaseNotificationClaim,
} from './canary-ledger';
import type { CanaryHitRecord, CanaryTrust } from './canary-types';

const log = createLogger('canary-service');

/** Notifications for the same token are collapsed inside this window. */
export const CANARY_NOTIFY_WINDOW_MS = 5 * 60 * 1000;

/** Subset of the notification service input used by the canary alert. */
export interface CanaryNotifyParams {
  type: 'canary_triggered';
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}

/** Evidence captured from the incoming request. */
export interface CanaryHitInput {
  tokenId: string;
  /** Raw socket address, null when unavailable. */
  ip: string | null;
  /** Raw X-Forwarded-For header, null when absent. */
  forwardedFor: string | null;
  /** User-Agent header, null when absent. */
  ua: string | null;
  now: Date;
}

/** Result of {@link handleCanaryHit}. */
export interface CanaryHitResult {
  matched: boolean;
  logged: boolean;
  notified: boolean;
}

/** Injection points (tests replace the notifier to avoid loading the DB). */
export interface CanaryDeps {
  notify?: (params: CanaryNotifyParams) => Promise<unknown>;
}

async function defaultNotify(params: CanaryNotifyParams): Promise<unknown> {
  // Lazy import: notification-service pulls in the Prisma client at load time.
  const { createNotification } = await import('../communication/notification-service');
  return createNotification(params);
}

function classifyTrust(ip: string | null, forwardedFor: string | null): CanaryTrust {
  if (!ip) return 'unknown';
  return forwardedFor ? 'forwarded' : 'direct';
}

/**
 * Process a hit on a canary URL.
 *
 * @param input - Request evidence / リクエスト情報
 * @param deps - Optional injected collaborators / 差し替え可能な依存
 * @returns What was matched, logged and notified / 照合・記録・通知の結果
 */
export async function handleCanaryHit(
  input: CanaryHitInput,
  deps: CanaryDeps = {},
): Promise<CanaryHitResult> {
  const token = findToken(input.tokenId);
  // Unknown ids leave no trace: the endpoint is unauthenticated, so recording
  // them would let anyone grow the log and flood notifications.
  if (!token) return { matched: false, logged: false, notified: false };

  const nowIso = input.now.toISOString();
  const record: CanaryHitRecord = {
    t: nowIso,
    tokenId: token.tokenId,
    label: token.label,
    ip: input.ip,
    forwardedFor: input.forwardedFor,
    ua: input.ua,
    stage: loadLedger().stage,
    trust: classifyTrust(input.ip, input.forwardedFor),
  };

  const logged = appendCanaryHit(record);
  if (!logged) log.error({ tokenId: token.tokenId }, 'Failed to append canary detection log');

  // Claim before awaiting: the check-and-set is synchronous, so concurrent hits
  // cannot all pass the window check while the first notification is in flight.
  const claim = claimNotificationWindow(token.tokenId, nowIso, CANARY_NOTIFY_WINDOW_MS);
  if (!claim.claimed) return { matched: true, logged, notified: false };

  const notify = deps.notify ?? defaultNotify;
  try {
    await notify({
      type: 'canary_triggered',
      title: `Canary token triggered: ${token.label}`,
      message: [
        `Canary "${token.label}" was used.`,
        `time: ${nowIso}`,
        `ip: ${record.ip ?? 'unknown'} (${record.trust})`,
        record.forwardedFor ? `x-forwarded-for: ${record.forwardedFor}` : null,
        `user-agent: ${record.ua ?? 'none'}`,
      ]
        .filter(Boolean)
        .join('\n'),
      metadata: { ...record },
    });
    return { matched: true, logged, notified: true };
  } catch (err) {
    // A failed delivery must not silence later alerts for the whole window.
    try {
      releaseNotificationClaim(token.tokenId, nowIso, claim.previous);
    } catch (releaseErr) {
      log.error({ err: releaseErr, tokenId: token.tokenId }, 'Failed to release canary claim');
    }
    log.error({ err, tokenId: token.tokenId }, 'Failed to create canary notification');
    return { matched: true, logged, notified: false };
  }
}
