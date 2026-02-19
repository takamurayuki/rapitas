/**
 * Habits API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";

export const habitsRoutes = new Elysia({ prefix: "/habits" })
  .get("/", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await prisma.habit.findMany({
      include: {
        logs: {
          where: { date: today },
        },
        _count: { select: { logs: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  .get("/:id", async (context: any) => {
    const { params } = context;
    const id = parseInt(params.id);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    return await prisma.habit.findUnique({
      where: { id },
      include: {
        logs: {
          where: { date: { gte: thirtyDaysAgo } },
          orderBy: { date: "desc" },
        },
      },
    });
  })

  .post(
    "/",
    async ({ body }) => {
      const { name, description, icon, color, frequency, targetCount } =
        body as any;
      return await prisma.habit.create({
        data: {
          name,
          ...(description && { description }),
          ...(icon && { icon }),
          ...(color && { color }),
          ...(frequency && { frequency }),
          ...(targetCount && { targetCount }),
        },
      });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        color: t.Optional(t.String()),
        frequency: t.Optional(t.String()),
        targetCount: t.Optional(t.Number()),
      }),
    },
  )

  .patch("/:id", async ({ params, body }) => {
    const id = parseInt(params.id);
    const { name, description, icon, color, frequency, targetCount, isActive } =
      body as any;
    return await prisma.habit.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(icon !== undefined && { icon }),
        ...(color && { color }),
        ...(frequency && { frequency }),
        ...(targetCount && { targetCount }),
        ...(isActive !== undefined && { isActive }),
      },
    });
  })

  .delete("/:id", async (context: any) => {
    const { params } = context;
    const id = parseInt(params.id);
    return await prisma.habit.delete({ where: { id } });
  })

  .post("/:id/log", async ({ params, body }) => {
    const id = parseInt(params.id);
    const { date, note } = body as any;

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    return await prisma.habitLog.upsert({
      where: {
        habitId_date: {
          habitId: id,
          date: targetDate,
        },
      },
      update: {
        count: { increment: 1 },
        ...(note && { note }),
      },
      create: {
        habitId: id,
        date: targetDate,
        count: 1,
        ...(note && { note }),
      },
    });
  });
