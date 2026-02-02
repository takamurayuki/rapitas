/**
 * SSE (Server-Sent Events) API Routes
 * Real-time event streaming endpoints
 */
import { Elysia } from "elysia";
import { realtimeService } from "../services/realtime-service";

export const sseRoutes = new Elysia({ prefix: "/events" })
  // Stream all events
  .get("/stream", ({ set }: { set: { headers: Record<string, string> } }) => {
    set.headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    };

    const clientId = realtimeService.registerClient(
      {
        write: (data: string) => {
          // Elysiaでは直接ストリームを返す必要がある
          // この実装は簡略化されている
        },
      },
      ["*"], // 全てのイベントを購読
    );

    // 接続情報を返す
    return new Response(
      new ReadableStream({
        start(controller) {
          const client = {
            write: (data: string) => {
              controller.enqueue(new TextEncoder().encode(data));
            },
          };

          realtimeService.removeClient(clientId);
          const newClientId = realtimeService.registerClient(client, ["*"]);

          // クローズ時のクリーンアップ
          // Note: Elysiaでは abort イベントの処理が異なる場合がある
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    );
  })

  // Subscribe to specific channel
  .get(
    "/subscribe/:channel",
    ({
      params,
      query,
      set,
    }: {
      params: { channel: string };
      query: { lastEventId?: string };
      set: { headers: Record<string, string> };
    }) => {
      const { channel } = params;
      const { lastEventId } = query;

      set.headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      };

      console.log(`[SSE] Client connecting to channel: ${channel}`);

      return new Response(
        new ReadableStream({
          start(controller) {
            const client = {
              write: (data: string) => {
                try {
                  controller.enqueue(new TextEncoder().encode(data));
                } catch (e) {
                  console.error(`[SSE] Error writing to client:`, e);
                }
              },
            };

            const clientId = realtimeService.registerClient(client, [channel]);
            console.log(
              `[SSE] Client ${clientId} registered for channel: ${channel}`,
            );

            // 接続確認イベントを即座に送信
            client.write(
              `event: connected\ndata: ${JSON.stringify({ channel, clientId })}\n\n`,
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
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    },
  )

  // Get SSE connection status
  .get("/status", () => {
    return {
      clientCount: realtimeService.getClientCount(),
      clients: realtimeService.getClients(),
    };
  });
