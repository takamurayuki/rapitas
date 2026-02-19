/**
 * Exam Goals API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError } from "../middleware/error-handler";

export const examGoalsRoutes = new Elysia({ prefix: "/exam-goals" })
  .get("/", async () => {
    return await prisma.examGoal.findMany({
      include: {
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: { examDate: "asc" },
    });
  })

  .get("/:id", async ({  params  }: any) => {
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError("無効なIDです");

    return await prisma.examGoal.delete({
      where: { id },
    });
  });
