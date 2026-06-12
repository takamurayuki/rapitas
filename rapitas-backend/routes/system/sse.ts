/**
 * SSE (Server-Sent Events) API Routes
 * Real-time event streaming endpoints
 */
import { Elysia, t } from 'elysia';
import { realtimeService } from '../../services/communication/realtime-service';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:sse');

// Must mirror the cors() allowlist in index.ts.
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'tauri://localhost',
];

/**
 * Build SSE response headers INCLUDING CORS. These routes return a raw
 * `new Response(stream)`, which bypasses the cors() middleware entirely — so
 * browser EventSources (cross-origin: 3000 → 3001) got no
 * Access-Control-Allow-Origin and fatally closed the moment the response
 * arrived. Every SSE stream in the browser was silently dead because of this;
 * curl worked (no Origin header), which masked it.
 *
 * @param request - Incoming request (for the Origin header) / リクエスト
 * @returns Headers for the streaming response / ストリーム応答ヘッダ
 */
function sseHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  };
  const origin = request.headers.get('origin');
  const allowed = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : DEFAULT_ALLOWED_ORIGINS;
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export const sseRoutes = new Elysia({ prefix: '/events' })
  // Stream all events
  .get('/stream', (context) => {
    const { set, request } = context;
    set.headers = sseHeaders(request);

    const clientId = realtimeService.registerClient(
      {
        write: (data: string) => {
          // NOTE: simplified implementation
        },
      },
      ['*'],
    );

    // Hold clientId in closure for cleanup
    let activeClientId = clientId;

    return new Response(
      new ReadableStream({
        start(controller) {
          const client = {
            write: (data: string) => {
              try {
                controller.enqueue(new TextEncoder().encode(data));
              } catch {
                realtimeService.removeClient(activeClientId);
              }
            },
          };

          realtimeService.removeClient(clientId);
          activeClientId = realtimeService.registerClient(client, ['*']);
          // Register controller to close stream on shutdown
          realtimeService.registerStreamController(activeClientId, controller);
        },
        cancel() {
          realtimeService.removeClient(activeClientId);
          realtimeService.removeStreamController(activeClientId);
          log.info(`[SSE] Client ${activeClientId} disconnected (stream)`);
        },
      }),
      {
        headers: sseHeaders(request),
      },
    );
  })

  // Subscribe to specific channel
  .get('/subscribe/:channel', (context) => {
    const { params, query, set, request } = context;
    const { channel } = params;
    const { lastEventId } = query;

    set.headers = sseHeaders(request);

    log.info(`[SSE] Client connecting to channel: ${channel}`);

    let activeClientId = '';

    return new Response(
      new ReadableStream({
        start(controller) {
          const client = {
            write: (data: string) => {
              try {
                controller.enqueue(new TextEncoder().encode(data));
              } catch {
                realtimeService.removeClient(activeClientId);
              }
            },
          };

          activeClientId = realtimeService.registerClient(client, [channel]);
          // Register controller to close stream on shutdown
          realtimeService.registerStreamController(activeClientId, controller);
          log.info(`[SSE] Client ${activeClientId} registered for channel: ${channel}`);

          // Send connection confirmation event immediately
          client.write(
            `event: connected\ndata: ${JSON.stringify({ channel, clientId: activeClientId })}\n\n`,
          );

          // Send past events if lastEventId is provided
          if (lastEventId) {
            const history = realtimeService.getChannelHistory(channel);
            for (const event of history) {
              if (event.id && event.id > lastEventId) {
                client.write(
                  `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
                );
              }
            }
          }
        },
        cancel() {
          realtimeService.removeClient(activeClientId);
          realtimeService.removeStreamController(activeClientId);
          log.info(`[SSE] Client ${activeClientId} disconnected (${channel})`);
        },
      }),
      {
        headers: sseHeaders(request),
      },
    );
  })

  // Get SSE connection status
  .get('/status', () => {
    return {
      clientCount: realtimeService.getClientCount(),
      clients: realtimeService.getClients(),
    };
  });
