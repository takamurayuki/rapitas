/**
 * Resources API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError } from "../middleware/error-handler";

export const resourcesRoutes = new Elysia()
  .get("/tasks/:id/resources", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError("無効なIDです");

    return await prisma.resource.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "desc" },
    });
  })

  .post(
    "/resources",
    async ({ body }: {
      body: {
        taskId?: number;
        title: string;
        url?: string;
        type: string;
        description?: string;
      }
    }) => {
      const { taskId, title, url, type, description } = body;
      return await prisma.resource.create({
        data: {
          title,
          type,
          ...(taskId && { taskId }),
          ...(url && { url }),
          ...(description && { description }),
        },
      });
    },
    {
      body: t.Object({
        taskId: t.Optional(t.Number()),
        title: t.String({ minLength: 1 }),
        url: t.Optional(t.String()),
        type: t.String(),
        description: t.Optional(t.String()),
      }),
    }
  )

  .delete("/resources/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError("無効なIDです");

    return await prisma.resource.delete({ where: { id } });
  });
