/**
 * SSE (Server-Sent Events) API Routes
 * Real-time event streaming endpoints
 */
import { Elysia, t } from 'elysia';
import { realtimeService } from '../../services/realtime-service';
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
          // Elysiaでは直接ストリームを返す必要がある
          // この実装は簡略化されている
        },
      },
      ['*'], // 全てのイベントを購読
    );

    // 接続情報を返す
    // クリーンアップ用にclientIdをクロージャで保持
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
          // シャットダウン時にストリームを閉じるためにcontrollerを登録
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
          // シャットダウン時にストリームを閉じるためにcontrollerを登録
          realtimeService.registerStreamController(activeClientId, controller);
          log.info(`[SSE] Client ${activeClientId} registered for channel: ${channel}`);

          // 接続確認イベントを即座に送信
          client.write(
            `event: connected\ndata: ${JSON.stringify({ channel, clientId: activeClientId })}\n\n`,
          );

          // 過去のイベントを送信（lastEventIdがある場合）
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
