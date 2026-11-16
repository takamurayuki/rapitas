/**
 * DeviceToken
 *
 * Issues and checks the per-device bearer tokens paired phones present to the
 * LAN gateway (#1421). Only the SHA-256 of a token is ever stored, so reading
 * mobile-link.json does not hand anyone a working credential.
 * Not responsible for persistence — see mobile-link-store.ts.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PairedDevice } from './mobile-link-store';

/**
 * Hash a token the way the store keeps it.
 *
 * @param token - Raw bearer token / 生のトークン
 * @returns Hex SHA-256 / SHA-256 の16進文字列
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Create a new random token (256 bits, base64url) and its stored hash.
 *
 * @returns The token to hand to the phone once, and the hash to keep / 発行するトークンと保存用ハッシュ
 */
export function issueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/**
 * Find the paired device a presented token belongs to.
 *
 * @param devices - Paired devices / ペアリング済み端末
 * @param token - Token from the Authorization header / 提示されたトークン
 * @returns The matching device, or null / 一致した端末（なければ null）
 */
export function findDeviceByToken(devices: PairedDevice[], token: string): PairedDevice | null {
  if (!token) return null;
  const presented = Buffer.from(hashToken(token), 'hex');
  let match: PairedDevice | null = null;
  // Compare against every entry (no early return) so timing does not reveal
  // how many devices exist or where a near-match sits.
  for (const device of devices) {
    const stored = Buffer.from(device.tokenHash, 'hex');
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) {
      match = device;
    }
  }
  return match;
}

/**
 * Read a bearer token from an Authorization header value.
 *
 * @param header - Raw header value / ヘッダー値
 * @returns The token, or null when absent or malformed / トークン（なければ null）
 */
export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
