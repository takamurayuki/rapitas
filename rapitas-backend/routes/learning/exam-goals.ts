/**
 * Exam Goals API Routes
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ValidationError } from '../../middleware/error-handler';

export const examGoalsRoutes = new Elysia({ prefix: '/exam-goals' })
  .get('/', async () => {
    return await prisma.examGoal.findMany({
      include: {
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: { examDate: 'asc' },
    });
  })

  .get('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('無効なIDです');

    return await prisma.examGoal.findUnique({
      where: { id },
      include: {
        tasks: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  })

  .post(
    '/',
    async (context) => {
      const { body } = context;
      const { name, description, examDate, targetScore, color, icon } = body as {
        name: string;
        examDate: string;
        description?: string | null;
        targetScore?: string | null;
        color?: string | null;
        icon?: string | null;
      };
      return await prisma.examGoal.create({
        data: {
          name,
          examDate: new Date(examDate),
          ...(description && { description }),
          ...(targetScore && { targetScore }),
          ...(color && { color }),
          ...(icon && { icon }),
        },
      });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        examDate: t.String(),
        description: t.Optional(t.Nullable(t.String())),
        targetScore: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.Nullable(t.String())),
        icon: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .patch('/:id', async (context) => {
    const { params, body } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('無効なIDです');

    const { name, description, examDate, targetScore, color, icon, isCompleted, actualScore } =
      body as {
        name?: string;
        description?: string;
        examDate?: string;
        targetScore?: string | null;
        color?: string;
        icon?: string | null;
        isCompleted?: boolean;
        actualScore?: string | null;
      };
    return await prisma.examGoal.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(examDate && { examDate: new Date(examDate) }),
        ...(targetScore !== undefined && { targetScore }),
        ...(color && { color }),
        ...(icon !== undefined && { icon }),
        ...(isCompleted !== undefined && { isCompleted }),
        ...(actualScore !== undefined && { actualScore }),
      },
    });
  })

  .delete('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('無効なIDです');

    return await prisma.examGoal.delete({
      where: { id },
    });
  });
