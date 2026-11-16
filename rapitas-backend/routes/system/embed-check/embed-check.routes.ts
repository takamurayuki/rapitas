/**
 * embed-check routes
 *
 * `POST /url-embed-check` — tells the web app's in-app browser whether a page
 * would render in its iframe, so a refusing site gets a "open it externally"
 * card instead of a blank frame. Thin layer; the logic is in
 * embed-check-service.ts and frame-policy.ts.
 *
 * Returns only `{ result }`. No header value, status or body from the page is
 * ever echoed, so the endpoint cannot be used to read anything.
 */
import { Elysia, t } from 'elysia';
import { resolveCorsOrigins } from '../../../config/cors-options';
import { checkEmbeddable, type EmbedCheckDeps } from './embed-check-service';
import type { EmbedVerdict } from './frame-policy';

/**
 * Whether the embedder is one of the app's own origins.
 *
 * The verdict is about framing on THAT origin, and the iframe only ever sits
 * in the app — an arbitrary origin is answered `unknown` rather than
 * evaluated, so this cannot be used as a framing oracle for other sites.
 */
function isTrustedEmbedder(origin: string): boolean {
  try {
    return resolveCorsOrigins(process.env.CORS_ORIGIN).includes(origin);
  } catch {
    return false;
  }
}

/**
 * Build the router; `deps` exists so tests can stub DNS and fetch.
 *
 * @param deps - Injected collaborators / 差し替え用の依存
 * @returns The Elysia router / ルーター
 */
export function createEmbedCheckRoutes(deps: EmbedCheckDeps = {}) {
  return new Elysia().post(
    '/url-embed-check',
    async ({ body }): Promise<{ result: EmbedVerdict }> => {
      if (!isTrustedEmbedder(body.origin)) return { result: 'unknown' };
      return { result: await checkEmbeddable(body.url, body.origin, deps) };
    },
    {
      body: t.Object({
        url: t.String({ maxLength: 4096 }),
        origin: t.String({ maxLength: 512 }),
      }),
    },
  );
}

export default createEmbedCheckRoutes();
