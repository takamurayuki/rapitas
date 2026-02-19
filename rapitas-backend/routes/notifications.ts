/**
 * Notifications API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError, NotFoundError } from "../middleware/error-handler";

export const notificationsRoutes = new Elysia({ prefix: "/notifications" })
  // Get notifications list
  .get("/", async (context: any) => {
      const { query  } = context;
    const { unreadOnly, limit  } = query as any;

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
  .patch("/:id/read", async (context: any) => {
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
  .delete("/:id", async (context: any) => {
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
