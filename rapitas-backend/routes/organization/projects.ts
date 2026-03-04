/**
 * Projects API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { projectSchema } from "../../schemas/project.schema";
import { ValidationError } from "../../middleware/error-handler";

export const projectsRoutes = new Elysia({ prefix: "/projects" })
  // Get all projects
  .get("/", async () => {
    return await prisma.project.findMany({
      include: {
        _count: {
          select: { tasks: true, milestones: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  // Get project by ID
  .get("/:id", async (context: any) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.project.findUnique({
      where: { id },
      include: {
        milestones: {
          orderBy: { createdAt: "asc" },
          include: {
            _count: { select: { tasks: true } },
          },
        },
        tasks: {
          where: { parentId: null },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  })

  // Create project
  .post(
    "/",
    async (context: any) => {
      const { body  } = context;
      const { name, description, color, icon  } = body as any;
      return await prisma.project.create({
        data: {
          name,
          ...(description && { description }),
          ...(color && { color }),
          ...(icon && { icon }),
        },
      });
    },
    {
      body: projectSchema.create,
    }
  )

  // Update project
  .patch(
    "/:id",
    async (context: any) => {
      const { params, body  } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError("無効なIDです");
      }

      const { name, description, color, icon  } = body as any;
      return await prisma.project.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(color && { color }),
          ...(icon !== undefined && { icon }),
        },
      });
    }
  )

  // Delete project
  .delete("/:id", async (context: any) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.project.delete({
      where: { id },
    });
  });
