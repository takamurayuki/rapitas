/**
 * Projects API Routes
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import { projectSchema } from "../schemas/project.schema";
import { ValidationError } from "../middleware/error-handler";

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
  .get("/:id", async ({  params  }: any) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.project.delete({
      where: { id },
    });
  });
