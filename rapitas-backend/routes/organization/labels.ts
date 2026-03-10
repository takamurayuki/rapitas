/**
 * Labels API Routes
 * Handles label CRUD operations and task-label associations
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { labelSchema } from '../../schemas/label.schema';
import { NotFoundError, ValidationError } from '../../middleware/error-handler';

export const labelsRoutes = new Elysia({ prefix: '/labels' })
  // Get all labels
  .get('/', async () => {
    return await prisma.label.findMany({
      include: {
        _count: {
          select: { tasks: true },
        },
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
      const { name, description, color, icon } = body as {
        name: string;
        description?: string;
        color?: string;
        icon?: string;
      };

      return await prisma.label.create({
        data: {
          name,
          ...(description && { description }),
          ...(color && { color }),
          ...(icon && { icon }),
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

      const { name, description, color, icon } = body as {
        name?: string;
        description?: string;
        color?: string;
        icon?: string;
      };

      return await prisma.label.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(color && { color }),
          ...(icon !== undefined && { icon }),
        },
      });
    },
    {
      body: labelSchema.update,
    },
  )

  // Reorder labels
  .patch('/reorder', async ({ body }) => {
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
  })

  // Delete label
  .delete('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError('無効なIDです');
    }

    return await prisma.label.delete({
      where: { id },
    });
  });

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
