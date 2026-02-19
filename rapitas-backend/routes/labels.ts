/**
 * Labels API Routes
 * Handles label CRUD operations and task-label associations
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import { labelSchema } from "../schemas/label.schema";
import { NotFoundError, ValidationError } from "../middleware/error-handler";

export const labelsRoutes = new Elysia({ prefix: "/labels" })
  // Get all labels
  .get("/", async ({ body }: any) => {
    return await prisma.label.findMany({
      include: {
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  })

  // Get label by ID
  .get("/:id", async ({  params  }: any) => {
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new ValidationError("無効なタスクIDです");
      }

      const { labelIds } = body as any;

      // Delete existing associations
      await prisma.taskLabel.deleteMany({
        where: { taskId },
      });

      // Create new associations
      if (labelIds && labelIds.length > 0) {
        await prisma.taskLabel.createMany({
          data: labelIds.map((labelId: number) => ({
            taskId,
            labelId,
          })),
        });
      }

      // Return updated task with labels
      return await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          taskLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    },
    {
      body: labelSchema.taskLabels,
    }
  );
