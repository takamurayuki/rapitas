/**
 * Milestones API Routes
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { milestoneSchema } from '../../schemas/milestone.schema';
import { ConflictError, NotFoundError, ValidationError } from '../../middleware/error-handler';
import { isValidEntityId } from '../../utils/common/id-validation';
import { normalizeCriteria } from '../../services/assistant/criteria-text';
import { toMilestoneView } from '../../services/goals';

export const milestonesRoutes = new Elysia({ prefix: '/milestones' })
  // Get all milestones
  .get('/', async (context) => {
    const { query } = context;
    const { projectId } = query as { projectId?: string };
    return await prisma.milestone.findMany({
      where: projectId ? { projectId: parseInt(projectId) } : undefined,
      include: {
        project: true,
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  })

  // Get milestone by ID
  .get('/:id', async (context) => {
    const { params } = context;
    if (!isValidEntityId(params.id)) {
      throw new ValidationError('無効なIDです');
    }
    const id = Number(params.id);

    return await prisma.milestone.findUnique({
      where: { id },
      include: {
        project: true,
        tasks: {
          where: { parentId: null },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  })

  // Create milestone
  .post(
    '/',
    async (context) => {
      const { body } = context;
      const { name, description, dueDate, projectId } = body as {
        name: string;
        projectId: number;
        description?: string;
        dueDate?: string;
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
    },
  )

  // Update milestone
  .patch(
    '/:id',
    async (context) => {
      const { params, body } = context;
      if (!isValidEntityId(params.id)) {
        throw new ValidationError('無効なIDです');
      }
      const id = Number(params.id);

      const { name, description, dueDate, acceptanceCriteria, status, sortOrder } = body;
      if (acceptanceCriteria !== undefined) {
        // NOTE: A reached milestone's criteria are what the person confirmed
        // against; editing them would silently change what was agreed. Reopen
        // (POST /milestones/:id/reopen) first.
        const current = await prisma.milestone.findUnique({ where: { id } });
        if (!current) throw new NotFoundError('節目が見つかりません');
        if (current.status === 'reached') {
          throw new ConflictError(
            '達成済みの節目の達成条件は変更できません。先に達成を取り消してください',
            'milestone_reached_locked',
          );
        }
      }
      const updated = await prisma.milestone.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(dueDate !== undefined && {
            dueDate: dueDate ? new Date(dueDate) : null,
          }),
          ...(acceptanceCriteria !== undefined && {
            acceptanceCriteria: JSON.stringify(normalizeCriteria(acceptanceCriteria)),
          }),
          ...(status !== undefined && { status }),
          ...(sortOrder !== undefined && { sortOrder }),
        },
      });
      return toMilestoneView(updated);
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 200 })),
        description: t.Optional(t.String({ maxLength: 5000 })),
        dueDate: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
        acceptanceCriteria: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 10 })),
        // `reached` is deliberately absent: only /milestones/:id/confirm sets it.
        status: t.Optional(t.Union([t.Literal('open'), t.Literal('paused')])),
        sortOrder: t.Optional(t.Integer({ minimum: 0, maximum: 100000 })),
      }),
    },
  )

  // Delete milestone
  .delete(
    '/:id',
    async (context) => {
      const { params } = context;
      if (!isValidEntityId(params.id)) {
        throw new ValidationError('無効なIDです');
      }
      const id = Number(params.id);

      return await prisma.milestone.delete({
        where: { id },
      });
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
