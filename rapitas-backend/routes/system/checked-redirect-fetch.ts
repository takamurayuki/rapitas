/**
 * checked-redirect-fetch
 *
 * Fetch a URL while following redirects by hand, re-validating every hop with
 * url-fetch-guard. Shared by /url-metadata and /url-embed-check so both apply
 * one SSRF rule. Not responsible for validating the FIRST URL (callers pass
 * an already-checked URL) or for reading the body.
 */
import { createLogger } from '../../config/logger';
import { MAX_REDIRECTS, assertFetchableUrl, type AddressResolver } from './url-fetch-guard';

const log = createLogger('routes:checked-redirect-fetch');

/** A desktop browser UA: some sites refuse or vary responses for unknown agents. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Options for {@link fetchWithCheckedRedirects}. */
export interface CheckedRedirectOptions {
  /** Carries the overall timeout for every hop. / 全体のタイムアウト */
  signal: AbortSignal;
  /** Injected for tests; defaults to real DNS. / 名前解決（テスト用に差し替え可） */
  resolver?: AddressResolver;
  /** Injected for tests; defaults to global fetch. / fetch（テスト用に差し替え可） */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch `startUrl`, following redirects MANUALLY so each hop is validated.
 *
 * NOTE: `redirect: 'manual'` and the per-hop `assertFetchableUrl` are the
 * point. `redirect: 'follow'` would let an allowed public host bounce the
 * request to an internal address, which is the standard way past an address
 * allowlist. The only header sent is `User-Agent` — no cookie, no auth — and
 * every redirect response's body is cancelled unread before the next hop.
 *
 * @param startUrl - Already-validated first URL / 検証済みの最初の URL
 * @param options - Signal and injectable collaborators / シグナルと差し替え
 * @returns The final response, or null after more than MAX_REDIRECTS hops / 最終レスポンス
 * @throws {ValidationError} When a redirect target is not fetchable / 転送先が取得不可のとき
 */
export async function fetchWithCheckedRedirects(
  startUrl: URL,
  options: CheckedRedirectOptions,
): Promise<Response | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetchImpl(current, {
      signal: options.signal,
      redirect: 'manual',
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    void res.body?.cancel().catch(() => {});
    // Relative redirects are resolved against the hop that issued them, then
    // validated like any other target.
    current = await assertFetchableUrl(new URL(location, current).toString(), options.resolver);
  }
  log.warn({ redirects: MAX_REDIRECTS }, 'checked-redirect-fetch: too many redirects');
  return null;
}
