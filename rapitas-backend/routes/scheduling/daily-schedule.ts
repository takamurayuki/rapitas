/**
 * Daily Schedule Block API Routes
 * Daily activity schedule blocks (used for pie chart display)
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';

export const dailyScheduleRoutes = new Elysia({ prefix: '/daily-schedule' })
  .get('/', async () => {
    return await prisma.dailyScheduleBlock.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  })

  .post(
    '/',
    async (context) => {
      const body = context.body as {
        label: string;
        startTime: string;
        endTime: string;
        color?: string;
        icon?: string;
        category?: string;
        isNotify?: boolean;
        sortOrder?: number;
      };
      const { label, startTime, endTime, color, icon, category, isNotify, sortOrder } = body;
      return await prisma.dailyScheduleBlock.create({
        data: {
          label,
          startTime,
          endTime,
          ...(color && { color }),
          ...(icon && { icon }),
          ...(category && { category }),
          ...(isNotify !== undefined && { isNotify }),
          ...(sortOrder !== undefined && { sortOrder }),
        },
      });
    },
    {
      body: t.Object({
        label: t.String({ minLength: 1 }),
        startTime: t.String(),
        endTime: t.String(),
        color: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        category: t.Optional(t.String()),
        isNotify: t.Optional(t.Boolean()),
        sortOrder: t.Optional(t.Number()),
      }),
    },
  )

  .patch(
    '/:id',
    async (context) => {
      const { params, body } = context;
      const id = parseInt(params.id);
      const { label, startTime, endTime, color, icon, category, isNotify, sortOrder } = body as {
        label?: string;
        startTime?: string;
        endTime?: string;
        color?: string;
        icon?: string;
        category?: string;
        isNotify?: boolean;
        sortOrder?: number;
      };
      return await prisma.dailyScheduleBlock.update({
        where: { id },
        data: {
          ...(label && { label }),
          ...(startTime && { startTime }),
          ...(endTime && { endTime }),
          ...(color && { color }),
          ...(icon !== undefined && { icon }),
          ...(category && { category }),
          ...(isNotify !== undefined && { isNotify }),
          ...(sortOrder !== undefined && { sortOrder }),
        },
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        label: t.Optional(t.String()),
        startTime: t.Optional(t.String()),
        endTime: t.Optional(t.String()),
        color: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        category: t.Optional(t.String()),
        isNotify: t.Optional(t.Boolean()),
        sortOrder: t.Optional(t.Number()),
      }),
    },
  )

  .delete(
    '/:id',
    async ({ params }) => {
      const id = parseInt(params.id);
      return await prisma.dailyScheduleBlock.delete({ where: { id } });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Bulk create/replace all blocks at once
  .put(
    '/bulk',
    async (context) => {
      const body = context.body as {
        blocks: Array<{
          label: string;
          startTime: string;
          endTime: string;
          color?: string;
          icon?: string;
          category?: string;
          isNotify?: boolean;
          sortOrder?: number;
        }>;
      };
      const { blocks } = body;
      // Delete all existing blocks and create new ones in a transaction
      await prisma.$transaction([
        prisma.dailyScheduleBlock.deleteMany(),
        ...body.blocks.map((block, index) =>
          prisma.dailyScheduleBlock.create({
            data: {
              label: block.label,
              startTime: block.startTime,
              endTime: block.endTime,
              color: block.color || '#3B82F6',
              icon: block.icon || null,
              category: block.category || 'other',
              isNotify: block.isNotify || false,
              sortOrder: block.sortOrder ?? index,
            },
          }),
        ),
      ]);

      return await prisma.dailyScheduleBlock.findMany({
        orderBy: { sortOrder: 'asc' },
      });
    },
    {
      body: t.Object({
        blocks: t.Array(
          t.Object({
            label: t.String({ minLength: 1 }),
            startTime: t.String(),
            endTime: t.String(),
            color: t.Optional(t.String()),
            icon: t.Optional(t.String()),
            category: t.Optional(t.String()),
            isNotify: t.Optional(t.Boolean()),
            sortOrder: t.Optional(t.Number()),
          }),
        ),
      }),
    },
  );
