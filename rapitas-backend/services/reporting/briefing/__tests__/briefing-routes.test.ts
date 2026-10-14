/**
 * briefing-routes.test
 *
 * Token gate of the briefing delivery routes (acceptance criterion 3: body
 * only retrievable through the authenticated endpoints).
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';

const dataDir = mkdtempSync(join(tmpdir(), 'briefing-routes-'));
process.env.RAPITAS_DATA_DIR = dataDir;

const { briefingRoutes } = await import('../../../../routes/briefing-routes');

const get = (path: string) => briefingRoutes.handle(new Request(`http://localhost${path}`));

describe('briefing routes', () => {
  beforeAll(() => {
    process.env.RAPITAS_BRIEFING_FEED_TOKEN = 'secret-token';
    const dir = join(dataDir, 'briefings');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '2026-10-14.json'),
      JSON.stringify({ text: '本文', hasAudio: true, estimatedSeconds: 1 }),
    );
    writeFileSync(join(dir, '2026-10-14.mp3'), new Uint8Array([1, 2]));
  });
  afterAll(() => {
    delete process.env.RAPITAS_BRIEFING_FEED_TOKEN;
  });

  it('returns 404 without a token', async () => {
    expect((await get('/briefing/2026-10-14/script')).status).toBe(404);
    expect((await get('/briefing/feed.xml')).status).toBe(404);
  });
  it('returns 404 for a wrong token', async () => {
    expect((await get('/briefing/2026-10-14/script?token=nope')).status).toBe(404);
  });
  it('returns 200 with the right token', async () => {
    const res = await get('/briefing/2026-10-14/script?token=secret-token');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }).text).toBe('本文');
    expect((await get('/briefing/2026-10-14/audio?token=secret-token')).status).toBe(200);
    const feed = await get('/briefing/feed.xml?token=secret-token');
    expect(await feed.text()).toContain('audio/mpeg');
  });
  it('serves wav audio with stored MIME and publishes measured duration in RSS', async () => {
    const dir = join(dataDir, 'briefings');
    writeFileSync(
      join(dir, '2026-10-15.json'),
      JSON.stringify({
        text: 't',
        hasAudio: true,
        audioFile: '2026-10-15.wav',
        audioMime: 'audio/wav',
        audioSeconds: 123.4,
        estimatedSeconds: 1,
      }),
    );
    writeFileSync(join(dir, '2026-10-15.wav'), new Uint8Array([9, 9]));
    const audio = await get('/briefing/2026-10-15/audio?token=secret-token');
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toContain('audio/wav');
    const xml = await (await get('/briefing/feed.xml?token=secret-token')).text();
    expect(xml).toContain('type="audio/wav"');
    expect(xml).toContain('<itunes:duration>124</itunes:duration>');
    expect((await get('/briefing/2026-10-15/audio?token=bad')).status).toBe(404);
  });
  it('is disabled when no server token is configured', async () => {
    delete process.env.RAPITAS_BRIEFING_FEED_TOKEN;
    expect((await get('/briefing/2026-10-14/script?token=secret-token')).status).toBe(404);
    process.env.RAPITAS_BRIEFING_FEED_TOKEN = 'secret-token';
  });
});
