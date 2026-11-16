/**
 * Mobile Link Routes
 *
 * Desktop-side settings for pairing phones (#1421): status, turning the LAN
 * gateway on and off, showing a pairing QR code and unpairing a device.
 * These run on the loopback API only; the gateway refuses every /mobile-link
 * path except the claim it serves itself, so a phone can never reach them.
 */
import { Elysia, t } from 'elysia';
import { HTTP_STATUS } from '../../../utils/common/http-status';
import { currentWorkspaceId } from '../../../services/tenancy/workspace-context';
import { getMobileLinkService, type MobileLinkService } from '../../../services/mobile-link';

/**
 * Build the routes over a service accessor.
 *
 * @param service - Returns the live service, or null outside the HTTP process / サービス取得関数
 * @returns The Elysia plugin / ルート
 */
export function createMobileLinkRoutes(
  service: () => MobileLinkService | null = getMobileLinkService,
) {
  const unavailable = (set: { status?: number | string }) => {
    set.status = HTTP_STATUS.SERVICE_UNAVAILABLE;
    return { success: false, error: 'mobile_link_unavailable' };
  };

  return new Elysia({ prefix: '/mobile-link' })
    .get('/', ({ set }) => {
      const s = service();
      return s ? s.status() : unavailable(set);
    })
    .post('/enable', ({ set }) => {
      const s = service();
      return s ? s.enable() : unavailable(set);
    })
    .post('/disable', ({ set }) => {
      const s = service();
      return s ? s.disable() : unavailable(set);
    })
    .post('/pairing', async ({ set }) => {
      const s = service();
      if (!s) return unavailable(set);
      const pairing = await s.createPairing(currentWorkspaceId());
      if (!pairing) {
        set.status = HTTP_STATUS.CONFLICT;
        return { success: false, error: 'mobile_link_disabled' };
      }
      return pairing;
    })
    .delete(
      '/devices/:id',
      ({ params, set }) => {
        const s = service();
        if (!s) return unavailable(set);
        if (!s.revoke(params.id)) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { success: false, error: 'device_not_found' };
        }
        return { success: true };
      },
      { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
    );
}

export default createMobileLinkRoutes();
