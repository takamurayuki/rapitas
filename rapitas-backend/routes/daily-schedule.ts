/**
 * Daily Schedule Block API Routes
 * 一日の行動スケジュール（円グラフ表示用）
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";

export const dailyScheduleRoutes = new Elysia({ prefix: "/daily-schedule" })
  .get("/", async () => {
    return await prisma.dailyScheduleBlock.findMany({
      orderBy: { sortOrder: "asc" },
    });
  })

  .post(
    "/",
    async ({ 

      body,
    }: {
      body: {
        label: string;
        startTime: string;
        endTime: string;
        color?: string;
        icon?: string;
        category?: string;
        isNotify?: boolean;
        sortOrder?: number;
      };
    }) => {
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
    }
  )

  .patch(
    "/:id",
    async ({ 

      params,
      body,
    }: {
      params: { id: string };
      body: {
        label?: string;
        startTime?: string;
        endTime?: string;
        color?: string;
        icon?: string;
        category?: string;
        isNotify?: boolean;
        sortOrder?: number;
      };
    }) => {
      const id = parseInt(params.id);
      const { label, startTime, endTime, color, icon, category, isNotify, sortOrder } = body;
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
    }
  )

  .delete("/:id", async ({ 
 params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    return await prisma.dailyScheduleBlock.delete({ where: { id } });
  })

  // Bulk create/replace all blocks at once
  .put(
    "/bulk",
    async ({ 

      body,
    }: {
      body: {
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
    }) => {
      // Delete all existing blocks and create new ones in a transaction
      await prisma.$transaction([
        prisma.dailyScheduleBlock.deleteMany(),
        ...body.blocks.map((block, index) =>
          prisma.dailyScheduleBlock.create({
            data: {
              label: block.label,
              startTime: block.startTime,
              endTime: block.endTime,
              color: block.color || "#3B82F6",
              icon: block.icon || null,
              category: block.category || "other",
              isNotify: block.isNotify || false,
              sortOrder: block.sortOrder ?? index,
            },
          })
        ),
      ]);

      return await prisma.dailyScheduleBlock.findMany({
        orderBy: { sortOrder: "asc" },
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
          })
        ),
      }),
    }
  );
