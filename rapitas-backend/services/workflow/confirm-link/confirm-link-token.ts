/**
 * confirm-link-token
 *
 * Signs and verifies the HMAC token carried by an external confirm link
 * (task 1430). Pure functions only: whether a link was already used or revoked
 * lives in confirm-link-store, not in the token.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** A link stops accepting answers 24 hours after it is issued (Q2). */
export const CONFIRM_LINK_TTL_MS = 86_400_000;

/** Shorter secrets are ignored so a typo cannot open the public routes. */
export const CONFIRM_LINK_SECRET_MIN_LENGTH = 32;

const TOKEN_VERSION = 'v1';
const LINK_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const EXPIRES_RE = /^\d{1,16}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

/** Outcome of {@link verifyConfirmLinkToken}. */
export type ConfirmLinkTokenResult =
  | { ok: true; linkId: string; expiresAt: number }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Generate a new link id: 16 random bytes as base64url (128 bits).
 *
 * @returns The link id / リンクID
 */
export function generateConfirmLinkId(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Read the signing secret, or null when the feature is disabled.
 *
 * @param env - Environment to read from / 参照する環境変数
 * @returns The secret, or null when unset or shorter than 32 characters / 秘密鍵、無効なら null
 */
export function resolveConfirmLinkSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.RAPITAS_CONFIRM_LINK_SECRET?.trim();
  return secret && secret.length >= CONFIRM_LINK_SECRET_MIN_LENGTH ? secret : null;
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Build the token `v1.<linkId>.<expiresAtMs>.<sig>`. The expiry is inside the
 * signed payload so expiry can be judged before any store lookup.
 *
 * @param claims - Link id and absolute expiry in epoch ms / リンクIDと失効時刻
 * @param secret - Signing secret / 署名鍵
 * @returns The token / トークン
 */
export function signConfirmLinkToken(
  claims: { linkId: string; expiresAt: number },
  secret: string,
): string {
  const payload = `${TOKEN_VERSION}.${claims.linkId}.${claims.expiresAt}`;
  return `${payload}.${signPayload(payload, secret)}`;
}

/**
 * Verify a token's shape, signature and expiry, in that order. The signature
 * is checked before expiry so a forged expiry is reported as tampering.
 *
 * @param token - Token from the URL / URL 内のトークン
 * @param secret - Signing secret / 署名鍵
 * @param now - Current epoch ms / 現在時刻
 * @returns The verified claims or the rejection reason / 検証結果
 */
export function verifyConfirmLinkToken(
  token: string,
  secret: string,
  now: number,
): ConfirmLinkTokenResult {
  const parts = token.split('.');
  if (parts.length !== 4) return { ok: false, reason: 'malformed' };
  const [version, linkId, expiresRaw, sig] = parts;
  if (
    version !== TOKEN_VERSION ||
    !LINK_ID_RE.test(linkId) ||
    !EXPIRES_RE.test(expiresRaw) ||
    !SIG_RE.test(sig)
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = Buffer.from(signPayload(`${version}.${linkId}.${expiresRaw}`, secret));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const expiresAt = Number(expiresRaw);
  if (now >= expiresAt) return { ok: false, reason: 'expired' };
  return { ok: true, linkId, expiresAt };
}
