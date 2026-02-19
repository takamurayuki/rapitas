/**
 * Habits API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";

export const habitsRoutes = new Elysia({ prefix: "/habits" })
  .get("/", async ({ body }: any) => {
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

  .get("/:id", async ({  params  }: any) => {
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
    }
  );
