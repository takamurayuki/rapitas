/**
 * MobileLinkService
 *
 * Turns the phone link on and off and owns everything that goes with it
 * (#1421): the LAN gateway listener, the mDNS advertisement, pairing codes
 * and the paired-device list. The desktop settings screen drives it through
 * routes/system/mobile-link; server-main starts it on boot when it was left on.
 * Not responsible for deciding what a paired device may call — that is the
 * same app the desktop uses, behind mobile-gateway.ts.
 */
import { hostname } from 'node:os';
import { createLogger } from '../../config/logger';
import { advertiseGateway, type Advertisement } from './mdns-advertiser';
import { createGatewayHandler } from './mobile-gateway';
import {
  createMobileLinkStore,
  type MobileLinkStore,
  type PairedDevice,
} from './mobile-link-store';
import { createPairingCodes, type PairingCodes } from './pairing-codes';
import { encodePairingUri, renderPairingQrSvg } from './pairing-payload';
import { lanAddresses } from './lan-addresses';

const log = createLogger('mobile-link');

export interface ListenerHandle {
  stop(): void;
}

/** Starts a listener on all interfaces; injectable so tests never bind a port. */
export type Listen = (
  port: number,
  fetch: (request: Request) => Promise<Response>,
) => ListenerHandle;

const bunListen: Listen = (port, fetch) => {
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port,
    fetch,
    // SSE stays open; the backend pings every 60s, so 2 minutes covers one missed ping.
    idleTimeout: 120,
  });
  return { stop: () => void server.stop(true) };
};

export interface MobileLinkStatus {
  enabled: boolean;
  /** Whether the gateway is actually listening (false with enabled = it failed to start). */
  listening: boolean;
  lastError: string | null;
  desktopId: string;
  desktopName: string;
  port: number;
  addresses: string[];
  devices: Array<Omit<PairedDevice, 'tokenHash'>>;
}

export interface MobileLinkServiceDeps {
  store?: MobileLinkStore;
  codes?: PairingCodes;
  listen?: Listen;
  advertise?: typeof advertiseGateway;
  addresses?: () => string[];
  desktopName?: () => string;
  /** Hand an authenticated gateway request to the real app. */
  forward: (request: Request, device: PairedDevice) => Response | Promise<Response>;
}

/**
 * Create the service.
 *
 * @param deps - Forwarder plus injectable store/listener/mDNS / 依存
 * @returns Status and control operations / 状態取得と操作
 */
export function createMobileLinkService(deps: MobileLinkServiceDeps) {
  const store = deps.store ?? createMobileLinkStore();
  const codes = deps.codes ?? createPairingCodes();
  const listen = deps.listen ?? bunListen;
  const advertise = deps.advertise ?? advertiseGateway;
  const addresses = deps.addresses ?? (() => lanAddresses());
  const desktopName = deps.desktopName ?? (() => hostname());

  const handler = createGatewayHandler({ store, codes, desktopName, forward: deps.forward });
  let listener: ListenerHandle | null = null;
  let advertisement: Advertisement | null = null;
  let lastError: string | null = null;

  function start(): void {
    if (listener) return;
    const state = store.read();
    try {
      listener = listen(state.gatewayPort, handler);
      lastError = null;
    } catch (error) {
      // Usually EADDRINUSE. Leave `enabled` on so the next boot retries, and
      // say why in the status the settings screen shows.
      lastError = error instanceof Error ? error.message : String(error);
      log.error({ err: error, port: state.gatewayPort }, 'mobile gateway failed to start');
      return;
    }
    advertisement = advertise({
      name: `Rapitas (${desktopName()})`,
      port: state.gatewayPort,
      desktopId: state.desktopId,
    });
    log.info({ port: state.gatewayPort }, 'mobile gateway listening');
  }

  function stop(): void {
    advertisement?.stop();
    advertisement = null;
    listener?.stop();
    listener = null;
    codes.clear();
  }

  function status(): MobileLinkStatus {
    const state = store.read();
    return {
      enabled: state.enabled,
      listening: listener !== null,
      lastError,
      desktopId: state.desktopId,
      desktopName: desktopName(),
      port: state.gatewayPort,
      addresses: addresses(),
      devices: state.devices.map(({ tokenHash: _omit, ...rest }) => rest),
    };
  }

  return {
    status,

    /** Start the gateway on boot if the user left the link on. */
    startIfEnabled(): void {
      if (store.read().enabled) start();
    },

    enable(): MobileLinkStatus {
      store.update((s) => ({ ...s, enabled: true }));
      start();
      return status();
    },

    disable(): MobileLinkStatus {
      store.update((s) => ({ ...s, enabled: false }));
      stop();
      return status();
    },

    /**
     * Issue a pairing code and its QR code. Requires the link to be on.
     *
     * @param workspaceId - Workspace the new device will act in / 端末が操作するワークスペース
     * @returns URI, SVG and expiry, or null when the link is off / QR 情報（無効時 null）
     */
    async createPairing(workspaceId: number | null) {
      const state = store.read();
      if (!state.enabled) return null;
      const { code, expiresAt } = codes.create(workspaceId);
      const uri = encodePairingUri({
        v: 1,
        id: state.desktopId,
        name: desktopName(),
        port: state.gatewayPort,
        hosts: addresses(),
        code,
        exp: expiresAt,
      });
      return {
        uri,
        svg: await renderPairingQrSvg(uri),
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    /**
     * Unpair one device; its token stops working on the next request.
     *
     * @param id - Device id / 端末ID
     * @returns Whether a device was removed / 削除したか
     */
    revoke(id: string): boolean {
      let removed = false;
      store.update((s) => {
        const devices = s.devices.filter((d) => d.id !== id);
        removed = devices.length !== s.devices.length;
        return { ...s, devices };
      });
      return removed;
    },

    stop,
  };
}

export type MobileLinkService = ReturnType<typeof createMobileLinkService>;
