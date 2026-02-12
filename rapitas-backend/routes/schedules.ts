/**
 * Schedule Events API Routes
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import { ValidationError, NotFoundError } from "../middleware/error-handler";

export const schedulesRoutes = new Elysia({ prefix: "/schedules" })
  // Get all schedule events (with optional date range filter)
  .get("/", async ({ query }: { query: { from?: string; to?: string } }) => {
    const { from, to } = query;

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
  .get("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError("Invalid ID");

    const event = await prisma.scheduleEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundError("Schedule event not found");

    return event;
  })

  // Create schedule event
  .post(
    "/",
    async ({
      body,
    }: {
      body: {
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
    }) => {
      if (!body.title?.trim()) throw new ValidationError("Title is required");
      if (!body.startAt)
        throw new ValidationError("Start date/time is required");

      return await prisma.scheduleEvent.create({
        data: {
          title: body.title.trim(),
          description: body.description?.trim() || null,
          startAt: new Date(body.startAt),
          endAt: body.endAt ? new Date(body.endAt) : null,
          isAllDay: body.isAllDay ?? false,
          color: body.color || "#6366F1",
          reminderMinutes: body.reminderMinutes ?? null,
          taskId: body.taskId ?? null,
          type: body.type as any || "GENERAL",
          userId: body.userId || "default",
        },
      });
    },
  )

  // Update schedule event
  .patch(
    "/:id",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: {
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
    }) => {
      const id = parseInt(params.id);
      if (isNaN(id)) throw new ValidationError("Invalid ID");

      const existing = await prisma.scheduleEvent.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("Schedule event not found");

      const data: Record<string, unknown> = {};
      if (body.title !== undefined) data.title = body.title.trim();
      if (body.description !== undefined) data.description = body.description;
      if (body.startAt !== undefined) data.startAt = new Date(body.startAt);
      if (body.endAt !== undefined)
        data.endAt = body.endAt ? new Date(body.endAt) : null;
      if (body.isAllDay !== undefined) data.isAllDay = body.isAllDay;
      if (body.color !== undefined) data.color = body.color;
      if (body.reminderMinutes !== undefined)
        data.reminderMinutes = body.reminderMinutes;
      if (body.reminderSentAt !== undefined)
        data.reminderSentAt = body.reminderSentAt
          ? new Date(body.reminderSentAt)
          : null;
      if (body.taskId !== undefined) data.taskId = body.taskId;

      return await prisma.scheduleEvent.update({
        where: { id },
        data,
      });
    },
  )

  // Delete schedule event
  .delete("/:id", async ({ params }: { params: { id: string } }) => {
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
    async ({ params }: { params: { id: string } }) => {
      const id = parseInt(params.id);
      if (isNaN(id)) throw new ValidationError("Invalid ID");

      return await prisma.scheduleEvent.update({
        where: { id },
        data: { reminderSentAt: new Date() },
      });
    },
  );
