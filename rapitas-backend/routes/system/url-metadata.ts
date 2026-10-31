/**
 * URL Metadata API Route
 * Fetches title and favicon from a given URL.
 *
 * Every outbound fetch goes through url-fetch-guard: the scheme, the host and
 * every address it resolves to are checked before the request, each redirect
 * hop is re-checked, and the body read is capped. Without that this endpoint
 * was an SSRF that also returned content — it hands back the fetched page's
 * `<title>`, so a caller could name an internal address and read a line of it.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import { MAX_REDIRECTS, assertFetchableUrl, readCappedText } from './url-fetch-guard';

const log = createLogger('routes:url-metadata');

/** How long the whole fetch, redirects included, may take. */
const FETCH_TIMEOUT_MS = 5000;

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch `startUrl`, following redirects MANUALLY so each hop is validated.
 *
 * NOTE: `redirect: 'follow'` would let an allowed public host bounce the
 * request to an internal address, which is the standard way past an
 * address allowlist.
 *
 * @param startUrl - Already-validated first URL / 検証済みの最初の URL
 * @param signal - Abort signal carrying the overall timeout / 全体タイムアウト
 * @returns The final response, or null when the chain could not be followed / 最終レスポンス
 */
async function fetchWithCheckedRedirects(
  startUrl: URL,
  signal: AbortSignal,
): Promise<Response | null> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    // Relative redirects are resolved against the hop that issued them, then
    // validated like any other target.
    current = await assertFetchableUrl(new URL(location, current).toString());
  }
  log.warn({ redirects: MAX_REDIRECTS }, 'url-metadata: too many redirects');
  return null;
}

/** The page title from `<title>`, or from `og:title`, or null. */
function extractTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  return ogMatch ? ogMatch[1].trim() : null;
}

export const urlMetadataRoutes = new Elysia().post(
  '/url-metadata',
  async (context) => {
    const { body, set } = context;
    const { url } = body as { url: string };

    let target: URL;
    try {
      target = await assertFetchableUrl(url);
    } catch (error) {
      // A refused URL is the caller's error, and saying so is better than
      // silently returning the raw string as its own title.
      set.status = 400;
      return {
        error: error instanceof Error ? error.message : 'URLを取得できません',
        url,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let title = target.hostname;
    try {
      const res = await fetchWithCheckedRedirects(target, controller.signal);
      if (res?.ok) {
        title = extractTitle(await readCappedText(res)) ?? title;
      }
    } catch {
      // Timeout, refused redirect target, or network error — the hostname is
      // still a usable title.
    } finally {
      clearTimeout(timeout);
    }

    // Favicon URL — use Google's favicon service for reliability.
    const favicon = `https://www.google.com/s2/favicons?domain=${target.hostname}&sz=32`;
    return { title, favicon, url, domain: target.hostname };
  },
  {
    body: t.Object({
      url: t.String(),
    }),
  },
);
