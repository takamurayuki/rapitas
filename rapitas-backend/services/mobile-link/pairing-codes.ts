/**
 * PairingCodes
 *
 * One-time codes shown in the desktop's QR code (#1421). A phone that presents
 * a live code gets a device token; the code is then spent. Kept in memory on
 * purpose: a restart simply invalidates any QR on screen.
 * Not responsible for issuing the device token — see device-token.ts.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** How long a QR code stays usable. */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

interface PendingCode {
  code: string;
  expiresAt: number;
  workspaceId: number | null;
}

export type ClaimResult =
  | { ok: true; workspaceId: number | null }
  | { ok: false; reason: 'invalid' | 'expired' };

/**
 * A pairing-code registry. Only the newest code is live: showing a new QR
 * retires the previous one, so a photo of an old screen is worthless.
 *
 * @param now - Clock (tests inject) / 現在時刻
 * @returns create / claim operations / 発行と引き換え
 */
export function createPairingCodes(now: () => number = Date.now) {
  let pending: PendingCode | null = null;

  return {
    /**
     * Issue a fresh code, retiring any previous one.
     *
     * @param workspaceId - Workspace the paired device will act in / 端末が操作するワークスペース
     * @returns The code and when it expires / コードと有効期限
     */
    create(workspaceId: number | null): { code: string; expiresAt: number } {
      // 128 bits: guessing is not a realistic attack, so no attempt counter is needed.
      const code = randomBytes(16).toString('base64url');
      pending = { code, expiresAt: now() + PAIRING_CODE_TTL_MS, workspaceId };
      return { code, expiresAt: pending.expiresAt };
    },

    /**
     * Spend a code. A wrong code leaves the live one intact.
     *
     * @param code - Code from the QR / QR に含まれるコード
     * @returns Whether it was accepted, and for which workspace / 引き換え結果
     */
    claim(code: string): ClaimResult {
      const live = pending;
      if (!live || !code) return { ok: false, reason: 'invalid' };
      const a = Buffer.from(live.code);
      const b = Buffer.from(code);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' };
      pending = null;
      if (now() > live.expiresAt) return { ok: false, reason: 'expired' };
      return { ok: true, workspaceId: live.workspaceId };
    },

    /** Retire the live code (e.g. when the link is turned off). */
    clear(): void {
      pending = null;
    },
  };
}

export type PairingCodes = ReturnType<typeof createPairingCodes>;
