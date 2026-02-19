/**
 * URL Metadata API Route
 * Fetches title and favicon from a given URL
 */
import { Elysia, t } from "elysia";

export const urlMetadataRoutes = new Elysia().post(
  "/url-metadata",
  async ({ 
 body }: { body: { url: string } }) => {
    const { url } = body;

    try {
      const parsedUrl = new URL(url);
      const origin = parsedUrl.origin;

      // Fetch the page HTML to extract title
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      let title = parsedUrl.hostname;
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        clearTimeout(timeout);

        if (res.ok) {
          const html = await res.text();

          // Extract <title>
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch) {
            title = titleMatch[1].trim();
          }

          // Try og:title as fallback
          if (title === parsedUrl.hostname) {
            const ogMatch = html.match(
              /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
            );
            if (ogMatch) {
              title = ogMatch[1].trim();
            }
          }
        }
      } catch {
        clearTimeout(timeout);
        // Timeout or fetch error — use hostname as title
      }

      // Favicon URL — use Google's favicon service for reliability
      const favicon = `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=32`;

      return { title, favicon, url, domain: parsedUrl.hostname };
    } catch {
      return { title: url, favicon: "", url, domain: "" };
    }
  },
  {
    body: t.Object({
      url: t.String(),
    }),
  },
);
