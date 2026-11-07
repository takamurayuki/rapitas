/**
 * mobile-link barrel
 *
 * Pairing phones with this desktop (#1421): QR pairing codes, per-device
 * tokens, the LAN gateway and its mDNS advertisement. The process-wide
 * instance is created by server-main (it alone knows how to forward a request
 * into the app) and read by the settings routes.
 */
import type { MobileLinkService, MobileLinkServiceDeps } from './mobile-link-service';
import { createMobileLinkService } from './mobile-link-service';

export {
  createMobileLinkService,
  type MobileLinkService,
  type MobileLinkStatus,
} from './mobile-link-service';
export {
  createMobileLinkStore,
  DEFAULT_GATEWAY_PORT,
  type PairedDevice,
} from './mobile-link-store';
export { createPairingCodes, PAIRING_CODE_TTL_MS } from './pairing-codes';
export { createGatewayHandler, CLAIM_PATH } from './mobile-gateway';
export { hashToken, issueToken, findDeviceByToken, readBearer } from './device-token';
export { encodePairingUri, PAIRING_URI_PREFIX, type PairingPayload } from './pairing-payload';
export { lanAddresses } from './lan-addresses';

let instance: MobileLinkService | null = null;

/**
 * Create the process-wide service. Called once from server-main.
 *
 * @param deps - Forwarder (and optional overrides) / 依存
 * @returns The service / サービス
 */
export function initMobileLinkService(deps: MobileLinkServiceDeps): MobileLinkService {
  instance?.stop();
  instance = createMobileLinkService(deps);
  return instance;
}

/** The process-wide service, or null in processes that do not serve HTTP (workers, tests). */
export function getMobileLinkService(): MobileLinkService | null {
  return instance;
}

/** Test hook: replace or clear the process-wide service. */
export function setMobileLinkServiceForTest(service: MobileLinkService | null): void {
  instance = service;
}
