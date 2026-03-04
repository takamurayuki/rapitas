/**
 * Comments API Routes
 * Task comments endpoints with link support
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { ValidationError, NotFoundError } from "../../middleware/error-handler";

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
  .get("/tasks/:id/comments", async (context) => {
    const taskId = parseInt(context.params.id);
    if (isNaN(taskId)) {
      throw new ValidationError("無効なタスクIDです");
    }

    return await prisma.comment.findMany({
      where: { taskId },
      include: {
        replies: {
          orderBy: { createdAt: "asc" },
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
        },
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
      orderBy: { createdAt: "desc" },
    });
  })

  // Create comment for a task (supports replies with parentId)
  .post(
    "/tasks/:id/comments",
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as { content: string; parentId?: number };
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new ValidationError("無効なタスクIDです");
      }

      const { content, parentId } = body;

      // 親コメントが指定されている場合、存在確認
      if (parentId !== undefined) {
        const parentComment = await prisma.comment.findUnique({
          where: { id: parentId },
        });
        if (!parentComment) {
          throw new NotFoundError("親コメントが見つかりません");
        }
        if (parentComment.taskId !== taskId) {
          throw new ValidationError("親コメントは同じタスクに属している必要があります");
        }
      }

      return await prisma.comment.create({
        data: {
          taskId,
          content,
          parentId: parentId ?? null,
        },
        include: {
          replies: true,
        },
      });
    },
    {
      body: t.Object({
        content: t.String({ minLength: 1 }),
        parentId: t.Optional(t.Number()),
      }),
    }
  )

  // Update comment
  .patch(
    "/comments/:id",
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as { content: string };
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

      const { content  } = body;
      return await prisma.comment.update({
        where: { id: commentId },
        data: { content },
      });
    },
    {
      body: t.Object({
        content: t.String({ minLength: 1 }),
      }),
    }
  )

  // Delete comment
  .delete("/comments/:id", async (context) => {
    const params = context.params as { id: string };
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
  })

  // ========== Comment Links API ==========

  // Create a link between two comments
  .post(
    "/comments/:id/links",
    async (context) => {
      const fromCommentId = parseInt(context.params.id);
      if (isNaN(fromCommentId)) {
        throw new ValidationError("無効なコメントIDです");
      }

      const { toCommentId, label  } = context.body as { toCommentId: number; label?: string };

      // Cannot link to self
      if (fromCommentId === toCommentId) {
        throw new ValidationError("同じメモにリンクすることはできません");
      }

      // Check both comments exist
      const [fromComment, toComment] = await Promise.all([
        prisma.comment.findUnique({ where: { id: fromCommentId } }),
        prisma.comment.findUnique({ where: { id: toCommentId } }),
      ]);

      if (!fromComment) {
        throw new NotFoundError("リンク元のメモが見つかりません");
      }
      if (!toComment) {
        throw new NotFoundError("リンク先のメモが見つかりません");
      }

      // Check if link already exists
      const existingLink = await prisma.commentLink.findUnique({
        where: {
          fromCommentId_toCommentId: { fromCommentId, toCommentId },
        },
      });

      if (existingLink) {
        throw new ValidationError("このリンクは既に存在します");
      }

      // Create the link
      const link = await prisma.commentLink.create({
        data: {
          fromCommentId,
          toCommentId,
          label: label || null,
        },
        include: {
          fromComment: {
            select: { id: true, content: true, taskId: true, createdAt: true },
          },
          toComment: {
            select: { id: true, content: true, taskId: true, createdAt: true },
          },
        },
      });

      return link;
    },
    {
      body: t.Object({
        toCommentId: t.Number(),
        label: t.Optional(t.String()),
      }),
    }
  )

  // Get all links for a comment
  .get("/comments/:id/links", async (context) => {
      const { params  } = context;
    const commentId = parseInt(params.id);
    if (isNaN(commentId)) {
      throw new ValidationError("無効なコメントIDです");
    }

    const comment = await getCommentWithLinks(commentId);
    if (!comment) {
      throw new NotFoundError("コメントが見つかりません");
    }

    // Combine outgoing and incoming links
    const outgoingLinks = comment.linksFrom.map((link: { id: number; label: string | null; createdAt: Date; toComment: { id: number; content: string; taskId: number; createdAt: Date } }) => ({
      id: link.id,
      direction: "outgoing" as const,
      label: link.label,
      linkedComment: link.toComment,
      createdAt: link.createdAt,
    }));

    const incomingLinks = comment.linksTo.map((link: { id: number; label: string | null; createdAt: Date; fromComment: { id: number; content: string; taskId: number; createdAt: Date } }) => ({
      id: link.id,
      direction: "incoming" as const,
      label: link.label,
      linkedComment: link.fromComment,
      createdAt: link.createdAt,
    }));

    return {
      commentId,
      links: [...outgoingLinks, ...incomingLinks],
    };
  })

  // Update a link label
  .patch(
    "/comment-links/:id",
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as { label?: string | null };

      const linkId = parseInt(params.id);
      if (isNaN(linkId)) {
        throw new ValidationError("無効なリンクIDです");
      }

      const link = await prisma.commentLink.findUnique({
        where: { id: linkId },
      });

      if (!link) {
        throw new NotFoundError("リンクが見つかりません");
      }

      return await prisma.commentLink.update({
        where: { id: linkId },
        data: { label: body.label ?? null },
        include: {
          fromComment: {
            select: { id: true, content: true, taskId: true, createdAt: true },
          },
          toComment: {
            select: { id: true, content: true, taskId: true, createdAt: true },
          },
        },
      });
    },
    {
      body: t.Object({
        label: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    }
  )

  // Delete a link
  .delete("/comment-links/:id", async (context) => {
      const { params  } = context;
    const linkId = parseInt(params.id);
    if (isNaN(linkId)) {
      throw new ValidationError("無効なリンクIDです");
    }

    const link = await prisma.commentLink.findUnique({
      where: { id: linkId },
    });

    if (!link) {
      throw new NotFoundError("リンクが見つかりません");
    }

    await prisma.commentLink.delete({
      where: { id: linkId },
    });

    return { success: true };
  })

  // Search comments for linking (across all tasks or within a task)
  .get(
    "/comments/search",
    async ({ 

      query,
    }: {
      query: { q?: string; taskId?: string; excludeId?: string; limit?: string };
    }) => {
      const { q, taskId, excludeId, limit  } = query;
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
