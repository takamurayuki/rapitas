/**
 * Time Entries API Routes
 * Task time tracking endpoints
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError } from "../middleware/error-handler";

export const timeEntriesRoutes = new Elysia()
  // Get time entries for a task
  .get("/tasks/:id/time-entries", async ({  params  }: any) => {
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new ValidationError("無効なタスクIDです");
      }

      const { duration, note, startedAt, endedAt } = body as any;
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
