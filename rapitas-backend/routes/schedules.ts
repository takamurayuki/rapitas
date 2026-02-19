/**
 * Schedule Events API Routes
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import { ValidationError, NotFoundError } from "../middleware/error-handler";

export const schedulesRoutes = new Elysia({ prefix: "/schedules" })
  // Get all schedule events (with optional date range filter)
  .get("/", async ({  query  }: any) => {
      const id = parseInt(params.id);
      if (isNaN(id)) throw new ValidationError("Invalid ID");

      return await prisma.scheduleEvent.update({
        where: { id },
        data: { reminderSentAt: new Date() },
      });
    },
  );
