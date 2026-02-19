/**
 * Comments API Routes
 * Task comments endpoints with link support
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError, NotFoundError } from "../middleware/error-handler";

// Helper to get comment with links
async function getCommentWithLinks(commentId: number) {
  return await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      linksFrom: {
        include: {
          toComment: {
            select: { id: true, content: true, taskId: true, createdAt: true },
          },
        },
      },
      linksTo: {
        include: {
          fromComment: {
            select: { id: true, content: true, taskId: true, createdAt: true },
          },
        },
      },
    },
  });
}

export const commentsRoutes = new Elysia()
  // Get comments for a task (with replies and links)
  .get("/tasks/:id/comments", async ({ params, query }: any) => {
      const { q, taskId, excludeId, limit } = query as any;
      const searchLimit = limit ? parseInt(limit) : 20;
      const excludeCommentId = excludeId ? parseInt(excludeId) : undefined;

      // Build where clause - only search parent comments (not replies)
      const whereClause: Record<string, unknown> = {
        parentId: null, // Only parent comments
      };

      if (excludeCommentId) {
        whereClause.id = { not: excludeCommentId };
      }

      if (taskId) {
        whereClause.taskId = parseInt(taskId);
      }

      // If search query provided, filter by content
      if (q && q.trim()) {
        whereClause.content = { contains: q.trim(), mode: "insensitive" };
      }

      const comments = await prisma.comment.findMany({
        where: whereClause,
        select: {
          id: true,
          content: true,
          taskId: true,
          createdAt: true,
          task: {
            select: { id: true, title: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: searchLimit,
      });

      return comments;
    }
  );
