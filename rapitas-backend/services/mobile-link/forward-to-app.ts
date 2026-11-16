/**
 * ForwardToApp
 *
 * How an authenticated gateway request enters the real app (#1421): the
 * phone's credentials are swapped for the ones the app itself understands, and
 * the request runs in the workspace the device was paired into.
 */
import { runInWorkspace } from '../tenancy/workspace-context';
import type { PairedDevice } from './mobile-link-store';

interface FetchableApp {
  fetch: (request: Request) => Response | Promise<Response>;
}

/**
 * Build the gateway's forwarder.
 *
 * @param app - The inner app (all routes and guards) / 実アプリケーション
 * @param apiToken - RAPITAS_API_TOKEN, if the main API enforces one / 本体APIのトークン
 * @returns forward(request, device) / 転送関数
 */
export function createAppForwarder(app: FetchableApp, apiToken: string | undefined) {
  return (request: Request, device: PairedDevice): Response | Promise<Response> => {
    const headers = new Headers(request.headers);
    // The device token proved who this is; it means nothing to the app. Drop it,
    // and drop cookies so a phone can never ride a desktop browser session.
    headers.delete('authorization');
    headers.delete('cookie');
    // When the main API also enforces RAPITAS_API_TOKEN, a paired device has
    // already been let in, so speak for it with the token the app expects.
    if (apiToken) headers.set('authorization', `Bearer ${apiToken}`);

    const inner = new Request(request.url, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      signal: request.signal,
      // Required by fetch when streaming a request body.
      duplex: 'half',
    } as RequestInit);

    if (device.workspaceId === null) return app.fetch(inner);
    return runInWorkspace(device.workspaceId, () => app.fetch(inner));
  };
}
