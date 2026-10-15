/**
 * briefing-routes
 *
 * Token-protected delivery of the night audio briefing: RSS feed, script
 * text and audio. Disabled (404) unless RAPITAS_BRIEFING_FEED_TOKEN is set so
 * a public URL never leaks content by default.
 */
import { Elysia, t } from 'elysia';
import { readFile } from 'fs/promises';
import { readdir } from 'fs/promises';
import { timingSafeEqual } from 'crypto';
import { join } from 'path';
import {
  briefingPaths,
  readStoredBriefing,
  resolveBriefingDataDir,
} from '../services/reporting/briefing/briefing-delivery';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function tokenOk(provided: string | undefined): boolean {
  const expected = process.env.RAPITAS_BRIEFING_FEED_TOKEN;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const tokenQuery = { query: t.Object({ token: t.Optional(t.String()) }) };

export const briefingRoutes = new Elysia({ prefix: '/briefing' })
  .get(
    '/feed.xml',
    async ({ query, set, request }) => {
      if (!tokenOk(query.token)) {
        set.status = 404;
        return { error: 'not found' };
      }
      const dataDir = resolveBriefingDataDir();
      const dir = briefingPaths(dataDir, '').dir;
      let dates: string[] = [];
      try {
        dates = (await readdir(dir))
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.slice(0, -5))
          .filter((d) => DATE_RE.test(d))
          .sort()
          .reverse()
          .slice(0, 30);
      } catch {
        // No briefings yet — serve an empty feed.
      }
      const origin = new URL(request.url).origin;
      const parts: string[] = [];
      for (const d of dates) {
        const stored = await readStoredBriefing(dataDir, d);
        if (!stored?.hasAudio) continue;
        const url = `${origin}/briefing/${d}/audio?token=${encodeURIComponent(query.token ?? '')}`;
        const mime = stored.audioMime ?? 'audio/mpeg';
        const duration =
          stored.audioSeconds != null
            ? `<itunes:duration>${Math.ceil(stored.audioSeconds)}</itunes:duration>`
            : '';
        parts.push(
          `<item><title>${xmlEscape(`夜間実行ブリーフィング ${d}`)}</title><guid isPermaLink="false">briefing:${d}</guid><enclosure url="${xmlEscape(url)}" type="${xmlEscape(mime)}"/>${duration}</item>`,
        );
      }
      const items = parts.join('');
      set.headers['content-type'] = 'application/rss+xml; charset=utf-8';
      return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Rapitas 夜間実行ブリーフィング</title><description>夜間実行結果の音声要約</description>${items}</channel></rss>`;
    },
    tokenQuery,
  )
  .get(
    '/:date/script',
    async ({ params, query, set }) => {
      if (!tokenOk(query.token) || !DATE_RE.test(params.date)) {
        set.status = 404;
        return { error: 'not found' };
      }
      const stored = await readStoredBriefing(resolveBriefingDataDir(), params.date);
      if (!stored) {
        set.status = 404;
        return { error: 'not found' };
      }
      return stored;
    },
    { params: t.Object({ date: t.String() }), ...tokenQuery },
  )
  .get(
    '/:date/audio',
    async ({ params, query, set }) => {
      if (!tokenOk(query.token) || !DATE_RE.test(params.date)) {
        set.status = 404;
        return { error: 'not found' };
      }
      try {
        const dataDir = resolveBriefingDataDir();
        const stored = await readStoredBriefing(dataDir, params.date);
        // Pre-WAV records have no audioFile and used <date>.mp3.
        const file = stored?.audioFile ?? `${params.date}.mp3`;
        const bytes = await readFile(join(briefingPaths(dataDir, params.date).dir, file));
        set.headers['content-type'] = stored?.audioMime ?? 'audio/mpeg';
        return new Response(bytes);
      } catch {
        set.status = 404;
        return { error: 'not found' };
      }
    },
    { params: t.Object({ date: t.String() }), ...tokenQuery },
  );
