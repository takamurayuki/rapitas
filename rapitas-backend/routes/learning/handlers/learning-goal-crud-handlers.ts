/**
 * Learning Goal CRUD Handlers
 *
 * Route handlers for list, detail, create, update, and delete operations
 * on LearningGoal records.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';

export const learningGoalCrudRoutes = new Elysia()
  .get('/', async () => {
    return await prisma.learningGoal.findMany({
      orderBy: { createdAt: 'desc' },
    });
  })

  .get('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    return await prisma.learningGoal.findUnique({
      where: { id },
    });
  })

  .post(
    '/',
    async (context) => {
      const { title, description, currentLevel, targetLevel, deadline, dailyHours, categoryId } =
        context.body as {
          title: string;
          description?: string;
          currentLevel?: string;
          targetLevel?: string;
          deadline?: string;
          dailyHours?: number;
          categoryId?: number;
        };

      return await prisma.learningGoal.create({
        data: {
          title,
          ...(description && { description }),
          ...(currentLevel && { currentLevel }),
          ...(targetLevel && { targetLevel }),
          ...(deadline && { deadline: new Date(deadline) }),
          ...(dailyHours !== undefined && { dailyHours }),
          ...(categoryId !== undefined && { categoryId }),
        },
      });
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        currentLevel: t.Optional(t.String()),
        targetLevel: t.Optional(t.String()),
        deadline: t.Optional(t.String()),
        dailyHours: t.Optional(t.Number()),
        categoryId: t.Optional(t.Number()),
      }),
    },
  )

  .patch(
    '/:id',
    async (context) => {
      const { params, body } = context;
      const id = parseInt(params.id as string);
      const updateData: Record<string, unknown> = {};

      const bodyData = body as {
        title?: string;
        description?: string;
        currentLevel?: string;
        targetLevel?: string;
        deadline?: string;
        dailyHours?: number;
        status?: string;
        isApplied?: boolean;
        themeId?: number;
      };

      if (bodyData.title !== undefined) updateData.title = bodyData.title;
      if (bodyData.description !== undefined) updateData.description = bodyData.description;
      if (bodyData.currentLevel !== undefined) updateData.currentLevel = bodyData.currentLevel;
      if (bodyData.targetLevel !== undefined) updateData.targetLevel = bodyData.targetLevel;
      if (bodyData.deadline !== undefined)
        updateData.deadline = bodyData.deadline ? new Date(bodyData.deadline) : null;
      if (bodyData.dailyHours !== undefined) updateData.dailyHours = bodyData.dailyHours;
      if (bodyData.status !== undefined) updateData.status = bodyData.status;
      if (bodyData.isApplied !== undefined) updateData.isApplied = bodyData.isApplied;
      if (bodyData.themeId !== undefined) updateData.themeId = bodyData.themeId;

      return await prisma.learningGoal.update({
        where: { id },
        data: updateData,
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        currentLevel: t.Optional(t.String()),
        targetLevel: t.Optional(t.String()),
        deadline: t.Optional(t.String()),
        dailyHours: t.Optional(t.Number()),
        status: t.Optional(t.String()),
        isApplied: t.Optional(t.Boolean()),
        themeId: t.Optional(t.Number()),
      }),
    },
  )

  .delete('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    return await prisma.learningGoal.delete({
      where: { id },
    });
  });
