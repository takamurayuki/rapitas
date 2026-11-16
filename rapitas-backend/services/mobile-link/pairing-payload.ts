/**
 * PairingPayload
 *
 * The contents of the pairing QR code (#1421), shared with rapitas-mobile's
 * `lib/services/pairing/pairing_payload.dart`. Changing a field here means
 * changing it there; bump `v` for anything incompatible.
 */
import QRCode from 'qrcode';

export const PAIRING_URI_PREFIX = 'rapitas://pair?d=';

export interface PairingPayload {
  v: 1;
  /** Desktop id, so the phone can find this desktop again by mDNS. */
  id: string;
  /** Desktop name to show on the phone. */
  name: string;
  /** Gateway port. */
  port: number;
  /** LAN addresses to try, best first. */
  hosts: string[];
  /** One-time pairing code. */
  code: string;
  /** Epoch ms after which the code is refused. */
  exp: number;
}

/**
 * Encode a payload as the URI the QR code holds.
 *
 * @param payload - Pairing details / ペアリング情報
 * @returns `rapitas://pair?d=<base64url JSON>` / QR に入れる URI
 */
export function encodePairingUri(payload: PairingPayload): string {
  return PAIRING_URI_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Render the URI as an SVG QR code for the desktop settings screen.
 *
 * @param uri - Pairing URI / ペアリング URI
 * @returns SVG markup / SVG 文字列
 */
export function renderPairingQrSvg(uri: string): Promise<string> {
  // Medium error correction: phones read it off a monitor, which is clean but glary.
  return QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
}
