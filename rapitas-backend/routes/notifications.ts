/**
 * Notifications API Routes
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import { ValidationError, NotFoundError } from "../middleware/error-handler";

export const notificationsRoutes = new Elysia({ prefix: "/notifications" })
  // Get notifications list
  .get("/", async ({  query  }: any) => {
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
  .delete("/", async ({ params }: any) => {
    const result = await prisma.notification.deleteMany({});
    return { success: true, deletedCount: result.count };
  });
