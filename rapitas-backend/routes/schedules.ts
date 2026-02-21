/**
 * Schedule Events API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError, NotFoundError } from "../middleware/error-handler";

export const schedulesRoutes = new Elysia({ prefix: "/schedules" })
  // Get all schedule events (with optional date range filter)
  .get("/", async (context: any) => {
      const { query  } = context;
    const { from, to  } = query as any;

    const where: Record<string, unknown> = {};
    if (from || to) {
      where.startAt = {};
      if (from) (where.startAt as Record<string, unknown>).gte = new Date(from);
      if (to) (where.startAt as Record<string, unknown>).lte = new Date(to);
    }

    return await prisma.scheduleEvent.findMany({
      where,
      orderBy: { startAt: "asc" },
    });
  })

  // Get single schedule event
  .get("/:id", async (context: any) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError("Invalid ID");

    const event = await prisma.scheduleEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundError("Schedule event not found");

    return event;
  })

  // Create schedule event
  .post(
    "/",
    async (context) => {
      const { body } = context;
      const data = body as {
        title: string;
        description?: string;
        startAt: string;
        endAt?: string;
        isAllDay?: boolean;
        color?: string;
        reminderMinutes?: number | null;
        taskId?: number | null;
        type?: string;
        userId?: string;
      };

      if (!data.title?.trim()) throw new ValidationError("Title is required");
      if (!data.startAt)
        throw new ValidationError("Start date/time is required");

      return await prisma.scheduleEvent.create({
        data: {
          title: data.title.trim(),
          description: data.description?.trim() || null,
          startAt: new Date(data.startAt),
          endAt: data.endAt ? new Date(data.endAt) : null,
          isAllDay: data.isAllDay ?? false,
          color: data.color || "#6366F1",
          reminderMinutes: data.reminderMinutes ?? null,
          taskId: data.taskId ?? null,
          type: (data.type === "PAID_LEAVE" ? "PAID_LEAVE" : "GENERAL"),
          userId: data.userId || "default",
        },
      });
    },
  )

  // Update schedule event
  .patch(
    "/:id",
    async (context) => {
      const { params, body } = context;
      const data_input = body as {
        title?: string;
        description?: string | null;
        startAt?: string;
        endAt?: string | null;
        isAllDay?: boolean;
        color?: string;
        reminderMinutes?: number | null;
        reminderSentAt?: string | null;
        taskId?: number | null;
        type?: string;
        userId?: string;
      };

      const id = parseInt(params.id);
      if (isNaN(id)) throw new ValidationError("Invalid ID");

      const existing = await prisma.scheduleEvent.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("Schedule event not found");

      const data: Record<string, unknown> = {};
      if (data_input.title !== undefined) data.title = data_input.title.trim();
      if (data_input.description !== undefined) data.description = data_input.description;
      if (data_input.startAt !== undefined) data.startAt = new Date(data_input.startAt);
      if (data_input.endAt !== undefined)
        data.endAt = data_input.endAt ? new Date(data_input.endAt) : null;
      if (data_input.isAllDay !== undefined) data.isAllDay = data_input.isAllDay;
      if (data_input.color !== undefined) data.color = data_input.color;
      if (data_input.reminderMinutes !== undefined)
        data.reminderMinutes = data_input.reminderMinutes;
      if (data_input.reminderSentAt !== undefined)
        data.reminderSentAt = data_input.reminderSentAt
          ? new Date(data_input.reminderSentAt)
          : null;
      if (data_input.taskId !== undefined) data.taskId = data_input.taskId;

      return await prisma.scheduleEvent.update({
        where: { id },
        data,
      });
    },
  )

  // Delete schedule event
  .delete("/:id", async (context: any) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError("Invalid ID");

    const existing = await prisma.scheduleEvent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Schedule event not found");

    await prisma.scheduleEvent.delete({ where: { id } });
    return { success: true, id };
  })

  // Get upcoming reminders (events with unsent reminders that are due)
  .get("/reminders/pending", async () => {
    const now = new Date();

    const events = await prisma.scheduleEvent.findMany({
      where: {
        reminderMinutes: { not: null },
        reminderSentAt: null,
        startAt: { gt: now },
      },
      orderBy: { startAt: "asc" },
    });

    // Filter events where reminder time has passed
    return events.filter(
      (event: { startAt: Date; reminderMinutes: number | null }) => {
        const reminderTime = new Date(
          event.startAt.getTime() - event.reminderMinutes! * 60 * 1000,
        );
        return reminderTime <= now;
      },
    );
  })

  // Mark reminder as sent
  .post(
    "/reminders/:id/sent",
    async (context: any) => {
      const { params  } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) throw new ValidationError("Invalid ID");

      return await prisma.scheduleEvent.update({
        where: { id },
        data: { reminderSentAt: new Date() },
      });
    },
  );
