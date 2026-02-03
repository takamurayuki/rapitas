/**
 * Comments API Routes
 * Task comments endpoints
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError, NotFoundError } from "../middleware/error-handler";

export const commentsRoutes = new Elysia()
  // Get comments for a task
  .get("/tasks/:id/comments", async ({ params }: { params: { id: string } }) => {
    const taskId = parseInt(params.id);
    if (isNaN(taskId)) {
      throw new ValidationError("無効なタスクIDです");
    }

    return await prisma.comment.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
  })

  // Create comment for a task
  .post(
    "/tasks/:id/comments",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { content: string };
    }) => {
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new ValidationError("無効なタスクIDです");
      }

      const { content } = body;
      return await prisma.comment.create({
        data: {
          taskId,
          content,
        },
      });
    },
    {
      body: t.Object({
        content: t.String({ minLength: 1 }),
      }),
    }
  )

  // Delete comment
  .delete("/comments/:id", async ({ params }: { params: { id: string } }) => {
    const commentId = parseInt(params.id);
    if (isNaN(commentId)) {
      throw new ValidationError("無効なコメントIDです");
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundError("コメントが見つかりません");
    }

    await prisma.comment.delete({
      where: { id: commentId },
    });

    return { success: true };
  });
