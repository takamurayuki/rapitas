/**
 * Labels API Routes
 * Handles label CRUD operations and task-label associations.
 * Labels are scoped per CATEGORY (2026-07 migration from per-theme scoping).
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { labelSchema } from '../../schemas/label.schema';
import { NotFoundError, ValidationError } from '../../middleware/error-handler';

// NOTE: One-shot backfill for the theme→category label migration: theme-scoped
// labels inherit their theme's category. Idempotent (only rows still missing
// categoryId are touched) and best-effort — a failure retries on next boot.
// Remove together with Label.themeId once all rows carry categoryId.
void (async () => {
  try {
    const orphans = await prisma.label.findMany({
      where: { categoryId: null, themeId: { not: null } },
      select: { id: true, theme: { select: { categoryId: true } } },
    });
    for (const label of orphans) {
      if (label.theme?.categoryId != null) {
        await prisma.label.update({
          where: { id: label.id },
          data: { categoryId: label.theme.categoryId },
        });
      }
    }
  } catch {
    /* best-effort — retried on next boot */
  }
})();

export const labelsRoutes = new Elysia({ prefix: '/labels' })
  // Get all labels (optionally filtered by categoryId via ?categoryId=N)
  .get('/', async ({ query }) => {
    const categoryId = query.categoryId ? parseInt(query.categoryId as string) : undefined;
    return await prisma.label.findMany({
      where: categoryId != null ? { categoryId } : undefined,
      include: {
        category: { select: { id: true, name: true, color: true, icon: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  })

  // Get label by ID
  .get('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError('無効なIDです');
    }

    const label = await prisma.label.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            task: true,
          },
        },
      },
    });

    if (!label) {
      throw new NotFoundError('ラベルが見つかりません');
    }

    return label;
  })

  // Create label
  .post(
    '/',
    async (context) => {
      const { body } = context;
      const { name, description, color, icon, categoryId } = body as {
        name: string;
        description?: string;
        color?: string;
        icon?: string;
        categoryId?: number | null;
      };

      return await prisma.label.create({
        data: {
          name,
          ...(description && { description }),
          ...(color && { color }),
          ...(icon && { icon }),
          ...(categoryId != null && { categoryId }),
        },
        include: {
          category: { select: { id: true, name: true, color: true, icon: true } },
          _count: { select: { tasks: true } },
        },
      });
    },
    {
      body: labelSchema.create,
    },
  )

  // Update label
  .patch(
    '/:id',
    async (context) => {
      const { params, body } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError('無効なIDです');
      }

      const { name, description, color, icon, categoryId } = body as {
        name?: string;
        description?: string;
        color?: string;
        icon?: string;
        categoryId?: number | null;
      };

      return await prisma.label.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(color && { color }),
          ...(icon !== undefined && { icon }),
          ...(categoryId !== undefined && { categoryId }),
        },
        include: {
          category: { select: { id: true, name: true, color: true, icon: true } },
          _count: { select: { tasks: true } },
        },
      });
    },
    {
      body: labelSchema.update,
    },
  )

  // Reorder labels
  .patch(
    '/reorder',
    async ({ body }) => {
      const { orders } = body as { orders: Array<{ id: number; sortOrder: number }> };

      await Promise.all(
        orders.map(({ id, sortOrder }) =>
          prisma.label.update({
            where: { id },
            data: { sortOrder },
          }),
        ),
      );

      return { success: true };
    },
    {
      body: t.Object({
        orders: t.Array(
          t.Object({
            id: t.Number(),
            sortOrder: t.Number(),
          }),
          { maxItems: 500 },
        ),
      }),
    },
  )

  // Delete label
  .delete(
    '/:id',
    async (context) => {
      const { params } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError('無効なIDです');
      }

      return await prisma.label.delete({
        where: { id },
      });
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );

/**
 * Task Labels Routes
 * Separate route group for task-label associations
 */
export const taskLabelsRoutes = new Elysia()
  // Update task labels (bulk)
  .put(
    '/tasks/:id/labels',
    async (context) => {
      const { params, body } = context;
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new ValidationError('無効なタスクIDです');
      }

      const { labelIds } = body as { labelIds: number[] };

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
    },
  );
