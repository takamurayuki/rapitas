/**
 * SSE (Server-Sent Events) API Routes
 * Real-time event streaming endpoints
 */
import { Elysia, t } from 'elysia';
import { realtimeService } from '../../services/communication/realtime-service';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:sse');

export const sseRoutes = new Elysia({ prefix: '/events' })
  // Stream all events
  .get('/stream', (context) => {
    const { set } = context;
    set.headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };

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
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      },
    );
  })

  // Subscribe to specific channel
  .get('/subscribe/:channel', (context) => {
    const { params, query, set } = context;
    const { channel } = params;
    const { lastEventId } = query;

    set.headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };

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
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
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
