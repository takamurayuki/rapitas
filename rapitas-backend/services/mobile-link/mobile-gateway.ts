/**
 * MobileGateway
 *
 * The LAN-facing front door for paired phones (#1421). The main API stays on
 * loopback; this handler sits on its own port and lets a request through only
 * when it carries a paired device's token. Pairing itself (spending a QR code)
 * is the one unauthenticated route.
 * Not responsible for listening — see mobile-link-service.ts.
 */
import { createLogger } from '../../config/logger';
import { HTTP_STATUS } from '../../utils/common/http-status';
import { findDeviceByToken, issueToken, readBearer } from './device-token';
import type { MobileLinkStore, PairedDevice } from './mobile-link-store';
import type { PairingCodes } from './pairing-codes';

const log = createLogger('mobile-link:gateway');

/** Only POST /mobile-link/claim is reachable from the LAN; the rest manage pairing. */
export const CLAIM_PATH = '/mobile-link/claim';
const MANAGEMENT_PREFIX = '/mobile-link';

/** lastSeenAt is a hint, not an audit log: write it at most once a minute per device. */
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

export interface GatewayDeps {
  store: MobileLinkStore;
  codes: PairingCodes;
  /** Name shown on the phone ("Yuki's PC"). */
  desktopName: () => string;
  /** Hand an authenticated request to the real app. */
  forward: (request: Request, device: PairedDevice) => Response | Promise<Response>;
  now?: () => number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Build the gateway's request handler.
 *
 * @param deps - Store, pairing codes and the forwarder / 依存
 * @returns A fetch handler / リクエストハンドラ
 */
export function createGatewayHandler(deps: GatewayDeps) {
  const now = deps.now ?? Date.now;

  async function claim(request: Request): Promise<Response> {
    let body: { code?: unknown; deviceName?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json(HTTP_STATUS.BAD_REQUEST, { error: 'invalid body' });
    }
    const code = typeof body.code === 'string' ? body.code : '';
    const result = deps.codes.claim(code);
    if (!result.ok) {
      log.warn({ reason: result.reason }, 'pairing claim rejected');
      return json(HTTP_STATUS.UNAUTHORIZED, { error: `pairing code ${result.reason}` });
    }
    const name =
      typeof body.deviceName === 'string' && body.deviceName.trim()
        ? body.deviceName.trim().slice(0, 80)
        : 'スマートフォン';
    const { token, tokenHash } = issueToken();
    const device: PairedDevice = {
      id: crypto.randomUUID(),
      name,
      tokenHash,
      workspaceId: result.workspaceId,
      createdAt: new Date(now()).toISOString(),
      lastSeenAt: null,
    };
    const state = deps.store.update((s) => ({ ...s, devices: [...s.devices, device] }));
    log.info({ deviceId: device.id }, 'device paired');
    return json(HTTP_STATUS.CREATED, {
      token,
      deviceId: device.id,
      desktopId: state.desktopId,
      desktopName: deps.desktopName(),
    });
  }

  function touch(device: PairedDevice): void {
    const last = device.lastSeenAt ? Date.parse(device.lastSeenAt) : 0;
    if (now() - last < LAST_SEEN_WRITE_INTERVAL_MS) return;
    try {
      deps.store.update((s) => ({
        ...s,
        devices: s.devices.map((d) =>
          d.id === device.id ? { ...d, lastSeenAt: new Date(now()).toISOString() } : d,
        ),
      }));
    } catch (error) {
      log.warn({ err: error }, 'could not record lastSeenAt');
    }
  }

  return async function handle(request: Request): Promise<Response> {
    const state = deps.store.read();
    if (!state.enabled)
      return json(HTTP_STATUS.SERVICE_UNAVAILABLE, { error: 'mobile link is off' });

    // The phone app never sends Origin; a browser always does on cross-origin
    // requests. Refusing it keeps any web page on the LAN from driving this port.
    if (request.headers.get('origin')) {
      return json(HTTP_STATUS.FORBIDDEN, { error: 'browser requests are not accepted' });
    }

    const path = new URL(request.url).pathname;
    if (path === CLAIM_PATH && request.method === 'POST') return claim(request);
    // A paired phone must not be able to mint more pairings or revoke others.
    if (path === MANAGEMENT_PREFIX || path.startsWith(`${MANAGEMENT_PREFIX}/`)) {
      return json(HTTP_STATUS.NOT_FOUND, { error: 'not found' });
    }

    const device = findDeviceByToken(
      state.devices,
      readBearer(request.headers.get('authorization')) ?? '',
    );
    if (!device) return json(HTTP_STATUS.UNAUTHORIZED, { error: 'unknown device' });
    touch(device);
    return deps.forward(request, device);
  };
}
