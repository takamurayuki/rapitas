/**
 * Milestones API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { milestoneSchema } from "../../schemas/milestone.schema";
import { ValidationError } from "../../middleware/error-handler";

export const milestonesRoutes = new Elysia({ prefix: "/milestones" })
  // Get all milestones
  .get("/", async (context) => {
      const { query  } = context;
    const { projectId  } = query as { projectId?: string };
    return await prisma.milestone.findMany({
      where: projectId ? { projectId: parseInt(projectId) } : undefined,
      include: {
        project: true,
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  })

  // Get milestone by ID
  .get("/:id", async (context) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.milestone.findUnique({
      where: { id },
      include: {
        project: true,
        tasks: {
          where: { parentId: null },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  })

  // Create milestone
  .post(
    "/",
    async (context) => {
      const { body  } = context;
      const { name, description, dueDate, projectId  } = body as {
        name: string; projectId: number; description?: string; dueDate?: string;
      };
      return await prisma.milestone.create({
        data: {
          name,
          projectId,
          ...(description && { description }),
          ...(dueDate && { dueDate: new Date(dueDate) }),
        },
        include: {
          project: true,
        },
      });
    },
    {
      body: milestoneSchema.create,
    }
  )

  // Update milestone
  .patch(
    "/:id",
    async (context) => {
      const { params, body  } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError("無効なIDです");
      }

      const { name, description, dueDate  } = body as { name?: string; description?: string; dueDate?: string | null };
      return await prisma.milestone.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(dueDate !== undefined && {
            dueDate: dueDate ? new Date(dueDate) : null,
          }),
        },
      });
    }
  )

  // Delete milestone
  .delete("/:id", async (context) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.milestone.delete({
      where: { id },
    });
  });
