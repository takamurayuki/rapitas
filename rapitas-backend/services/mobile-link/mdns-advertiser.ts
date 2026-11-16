/**
 * MdnsAdvertiser
 *
 * Announces the LAN gateway as `_rapitas._tcp` so a paired phone finds this
 * desktop again after its IP changes (#1421). The TXT record carries the
 * desktop id, which is how the phone tells its own desktop from someone
 * else's on the same network. Advertising is best-effort: if multicast is
 * unavailable the phone still has the addresses from the QR code.
 */
import { Bonjour, type Service } from 'bonjour-service';
import { createLogger } from '../../config/logger';

const log = createLogger('mobile-link:mdns');

/** DNS-SD service type, without the leading underscore or protocol. */
export const MDNS_SERVICE_TYPE = 'rapitas';

export interface Advertisement {
  stop(): void;
}

/**
 * Start advertising the gateway.
 *
 * @param opts - Name shown on the phone, port and desktop id / 表示名・ポート・デスクトップID
 * @returns A handle to stop advertising / 停止用ハンドル
 */
export function advertiseGateway(opts: {
  name: string;
  port: number;
  desktopId: string;
}): Advertisement {
  let bonjour: Bonjour | null = null;
  let service: Service | null = null;
  try {
    bonjour = new Bonjour({}, (error: unknown) => log.warn({ err: error }, 'mDNS error'));
    service = bonjour.publish({
      name: opts.name,
      type: MDNS_SERVICE_TYPE,
      protocol: 'tcp',
      port: opts.port,
      txt: { id: opts.desktopId, v: '1' },
    });
    service.on('error', (error: unknown) => log.warn({ err: error }, 'mDNS publish failed'));
  } catch (error) {
    log.warn({ err: error }, 'mDNS unavailable; phones will use the QR addresses only');
  }
  return {
    stop() {
      try {
        service?.stop?.();
        bonjour?.destroy();
      } catch (error) {
        log.warn({ err: error }, 'mDNS stop failed');
      }
    },
  };
}
