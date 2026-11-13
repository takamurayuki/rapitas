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
import { assertFetchableUrl, readCappedText } from './url-fetch-guard';
import { fetchWithCheckedRedirects } from './checked-redirect-fetch';

// NOTE: The redirect-following fetch moved to checked-redirect-fetch.ts so
// /url-embed-check applies the exact same per-hop SSRF check.

/** How long the whole fetch, redirects included, may take. */
const FETCH_TIMEOUT_MS = 5000;

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
    const { body } = context;
    const { url } = body as { url: string };

    let target: URL;
    try {
      target = await assertFetchableUrl(url);
    } catch {
      // NOTE: A refused URL keeps the pre-existing fallback contract — HTTP 200
      // with the raw string as its own title — instead of becoming a 400. The
      // security property is that the fetch does not happen, not that an error
      // is reported, and callers rely on always getting a usable shape back
      // (pinned by tests/routes/system/url-metadata-routes.test.ts). A URL that
      // merely times out already behaves this way. Changing it to 400 broke
      // that test, which the advisory full suite caught.
      return { title: url, favicon: '', url, domain: '' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let title = target.hostname;
    try {
      const res = await fetchWithCheckedRedirects(target, { signal: controller.signal });
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
