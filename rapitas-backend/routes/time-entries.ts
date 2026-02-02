/**
 * Time Entries API Routes
 * Task time tracking endpoints
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError } from "../middleware/error-handler";

export const timeEntriesRoutes = new Elysia()
  // Get time entries for a task
  .get("/tasks/:id/time-entries", async ({ params }: { params: { id: string } }) => {
    const taskId = parseInt(params.id);
    if (isNaN(taskId)) {
      throw new ValidationError("無効なタスクIDです");
    }

    return await prisma.timeEntry.findMany({
      where: { taskId },
      orderBy: { startedAt: "desc" },
    });
  })

  // Create time entry for a task
  .post(
    "/tasks/:id/time-entries",
    async ({ params, body }: {
      params: { id: string };
      body: {
        duration: number;
        startedAt: string;
        endedAt: string;
        note?: string;
      }
    }) => {
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new ValidationError("無効なタスクIDです");
      }

      const { duration, note, startedAt, endedAt } = body;
      return await prisma.timeEntry.create({
        data: {
          taskId,
          duration,
          note,
          startedAt: new Date(startedAt),
          endedAt: new Date(endedAt),
        },
      });
    },
    {
      body: t.Object({
        duration: t.Number({ minimum: 0 }),
        startedAt: t.String(),
        endedAt: t.String(),
        note: t.Optional(t.String()),
      }),
    }
  );
