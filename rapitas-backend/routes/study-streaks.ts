/**
 * Study Streak API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";

export const studyStreaksRoutes = new Elysia({ prefix: "/study-streaks" })
  .get("/", async ({  query  }: any) => {
      const { date, studyMinutes, tasksCompleted } = body as any;

      const targetDate = date ? new Date(date) : new Date();
      targetDate.setHours(0, 0, 0, 0);

      return await prisma.studyStreak.upsert({
        where: { date: targetDate },
        update: {
          ...(studyMinutes !== undefined && {
            studyMinutes: { increment: studyMinutes || 0 },
          }),
          ...(tasksCompleted !== undefined && {
            tasksCompleted: { increment: tasksCompleted || 0 },
          }),
        },
        create: {
          date: targetDate,
          studyMinutes: studyMinutes || 0,
          tasksCompleted: tasksCompleted || 0,
        },
      });
    },
    {
      body: t.Object({
        date: t.Optional(t.Nullable(t.String())),
        studyMinutes: t.Optional(t.Nullable(t.Number())),
        tasksCompleted: t.Optional(t.Nullable(t.Number())),
      }),
    }
  );
