/**
 * SSE CORS テスト
 *
 * SSEルートは生の Response を返すため cors() ミドルウェアが効かない。
 * ブラウザの EventSource は cross-origin 応答に Access-Control-Allow-Origin が
 * 無いと即・恒久クローズする（全SSEが無言で死んでいた実バグ）。許可オリジンの
 * 反映・非許可オリジンの不付与・SSE Content-Type を検証する。
 */
import { describe, test, expect, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { sseRoutes } = await import('../../routes/system/sse');

function createApp() {
  return new Elysia().use(sseRoutes);
}

/** Read headers then cancel the stream so the test doesn't hang on it. */
async function requestSse(path: string, origin?: string): Promise<Response> {
  const app = createApp();
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      headers: origin ? { origin } : {},
    }),
  );
  await res.body?.cancel();
  return res;
}

describe('SSE CORS headers', () => {
  test('許可オリジンからの /subscribe/:channel に ACAO が付くこと', async () => {
    const res = await requestSse('/events/subscribe/%2A', 'http://localhost:3000');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  test('tauri://localhost（デスクトップ）も許可されること', async () => {
    const res = await requestSse('/events/subscribe/notifications', 'tauri://localhost');

    expect(res.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
  });

  test('非許可オリジンには ACAO を付与しないこと', async () => {
    const res = await requestSse('/events/subscribe/%2A', 'https://evil.example.com');

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('/stream にも同じ CORS 反映が効くこと', async () => {
    const res = await requestSse('/events/stream', 'http://localhost:3000');

    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});
