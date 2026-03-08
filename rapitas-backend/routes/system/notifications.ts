/**
 * Notifications API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { ValidationError, NotFoundError } from "../../middleware/error-handler";
import { realtimeService } from "../../services/realtime-service";
import { createLogger } from "../../config/logger";

const logger = createLogger("routes:notifications");

export const notificationsRoutes = new Elysia({ prefix: "/notifications" })
  // SSEストリーム（リアルタイム通知配信）
  .get("/stream", ({ set }) => {
    set.headers["Content-Type"] = "text/event-stream";
    set.headers["Cache-Control"] = "no-cache";
    set.headers["Connection"] = "keep-alive";
    set.headers["Access-Control-Allow-Origin"] = "*";

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const clientId = realtimeService.registerClient(
          {
            write: (data: string) => {
              try {
                controller.enqueue(encoder.encode(data));
              } catch {
                // stream closed
              }
            },
          },
          ["notifications"]
        );

        realtimeService.registerStreamController(clientId, controller);

        // 初期の未読数を送信
        prisma.notification
          .count({ where: { isRead: false } })
          .then((count) => {
            try {
              const msg = `event: init\ndata: ${JSON.stringify({ unreadCount: count })}\n\n`;
              controller.enqueue(encoder.encode(msg));
            } catch {
              // ignore
            }
          })
          .catch((err) => {
            logger.warn({ err }, "Failed to fetch initial unread count for SSE stream");
          });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  })
  // Get notifications list
  .get("/", async (context) => {
      const { query  } = context;
    const { unreadOnly, limit  } = query as { unreadOnly?: string; limit?: string };

    return await prisma.notification.findMany({
      where: unreadOnly === "true" ? { isRead: false } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit ? parseInt(limit) : 50,
    });
  })

  // Get unread count
  .get("/unread-count", async () => {
    const count = await prisma.notification.count({
      where: { isRead: false },
    });
    return { count };
  })

  // Mark as read
  .patch("/:id/read", async (context) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  })

  // Mark all as read
  .post("/mark-all-read", async () => {
    await prisma.notification.updateMany({
      where: { isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true };
  })

  // Delete notification
  .delete("/:id", async (context) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    const existing = await prisma.notification.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError("通知が見つかりません");
    }

    await prisma.notification.delete({
      where: { id },
    });

    return { success: true, id };
  })

  // Delete all notifications
  .delete("/", async () => {
    const result = await prisma.notification.deleteMany({});
    return { success: true, deletedCount: result.count };
  });
