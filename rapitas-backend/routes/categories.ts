/**
 * Categories API Routes
 * Handles category CRUD operations (top-level classification above themes)
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { categorySchema } from "../schemas/category.schema";
import { NotFoundError, ValidationError } from "../middleware/error-handler";

// Default category definitions
const DEFAULT_CATEGORIES = [
  {
    name: "開発",
    description: "開発プロジェクトに関するテーマ",
    color: "#3B82F6",
    icon: "Code",
    mode: "development",
    sortOrder: 0,
  },
  {
    name: "学習",
    description: "学習に関するテーマ",
    color: "#10B981",
    icon: "BookOpen",
    mode: "learning",
    sortOrder: 1,
  },
];

export const categoriesRoutes = new Elysia({ prefix: "/categories" })
  // Seed default categories (idempotent) - also cleans up duplicates
  .post("/seed-defaults", async () => {
    const results = [];
    for (const def of DEFAULT_CATEGORIES) {
      // Find all categories with this name
      const allMatches = await prisma.category.findMany({
        where: { name: def.name },
        orderBy: { id: "asc" },
        include: { _count: { select: { themes: true } } },
      });

      if (allMatches.length === 0) {
        // No category exists, create one
        const created = await prisma.category.create({
          data: { ...def, isDefault: true },
          include: { _count: { select: { themes: true } } },
        });
        results.push(created);
      } else {
        // Keep the first one, delete duplicates
        const [keep, ...duplicates] = allMatches;
        for (const dup of duplicates) {
          // Reassign any themes from duplicate to the kept category
          await prisma.theme.updateMany({
            where: { categoryId: dup.id },
            data: { categoryId: keep.id },
          });
          await prisma.category.delete({ where: { id: dup.id } });
        }
        // Ensure mode is set for existing default categories
        if (keep.mode !== def.mode) {
          const updated = await prisma.category.update({
            where: { id: keep.id },
            data: { mode: def.mode },
            include: { _count: { select: { themes: true } } },
          });
          results.push(updated);
        } else {
          results.push(keep);
        }
      }
    }
    // Auto-assign development themes without a category to the "開発" category
    const devCategory = results.find((c) => c.name === "開発");
    if (devCategory) {
      await prisma.theme.updateMany({
        where: { isDevelopment: true, categoryId: null },
        data: { categoryId: devCategory.id },
      });
    }

    return results;
  })

  // Get default category ID from settings
  .get("/default-category", async () => {
    const settings = await prisma.userSettings.findFirst();
    if (!settings?.defaultCategoryId) {
      return { defaultCategoryId: null };
    }
    const category = await prisma.category.findUnique({
      where: { id: settings.defaultCategoryId },
    });
    if (!category) {
      return { defaultCategoryId: null };
    }
    return { defaultCategoryId: settings.defaultCategoryId, category };
  })

  // Get all categories with theme counts
  .get("/", async () => {
    return await prisma.category.findMany({
      include: {
        _count: {
          select: { themes: true },
        },
        themes: {
          select: {
            id: true,
            name: true,
            color: true,
            icon: true,
            isDefault: true,
            _count: {
              select: { tasks: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  })

  // Get category by ID
  .get(
    "/:id",
    async (context: any) => {
      const { params  } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError("Invalid ID");
      }

      const category = await prisma.category.findUnique({
        where: { id },
        include: {
          themes: {
            include: {
              _count: {
                select: { tasks: true },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!category) {
        throw new NotFoundError("Category not found");
      }

      return category;
    }
  )

  // Create category
  .post(
    "/",
    async (context: any) => {
      const { body  } = context;
      const { name, description, color, icon, mode, sortOrder  } = body as any;

      return await prisma.category.create({
        data: {
          name,
          ...(description && { description }),
          ...(color && { color }),
          ...(icon && { icon }),
          ...(mode && { mode }),
          ...(sortOrder !== undefined && { sortOrder }),
        },
        include: {
          _count: {
            select: { themes: true },
          },
        },
      });
    },
    {
      body: categorySchema.create,
    }
  )

  // Update category
  .patch(
    "/:id",
    async (context: any) => {
      const { params, body  } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError("Invalid ID");
      }

      const existing = await prisma.category.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundError("Category not found");
      }

      const { name, description, color, icon, mode, sortOrder  } = body as any;

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (color !== undefined) updateData.color = color;
      if (icon !== undefined) updateData.icon = icon;
      if (mode !== undefined) updateData.mode = mode;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

      return await prisma.category.update({
        where: { id },
        data: updateData,
        include: {
          _count: {
            select: { themes: true },
          },
        },
      });
    },
    {
      body: categorySchema.update,
    }
  )

  // Delete category (default categories cannot be deleted)
  .delete("/:id", async (context: any) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("Invalid ID");
    }

    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundError("Category not found");
    }
    if (category.isDefault) {
      throw new ValidationError("デフォルトカテゴリは削除できません");
    }

    return await prisma.category.delete({
      where: { id },
    });
  })

  // Set default category (for task list initial selection)
  .patch(
    "/:id/set-default",
    async (context: any) => {
      const { params  } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError("Invalid ID");
      }

      const category = await prisma.category.findUnique({ where: { id } });
      if (!category) {
        throw new NotFoundError("Category not found");
      }

      // Update UserSettings.defaultCategoryId
      let settings = await prisma.userSettings.findFirst();
      if (!settings) {
        settings = await prisma.userSettings.create({
          data: { defaultCategoryId: id },
        });
      } else {
        settings = await prisma.userSettings.update({
          where: { id: settings.id },
          data: { defaultCategoryId: id },
        });
      }

      return {
        ...category,
        isDefaultCategory: true,
      };
    }
  )

  // Reorder categories
  .patch(
    "/reorder",
    async ({ 
 body }: {
      body: { orders: Array<{ id: number; sortOrder: number }> }
    }) => {
      const { orders  } = body as any;

      await Promise.all(
        orders.map(({ id, sortOrder }) =>
          prisma.category.update({
            where: { id },
            data: { sortOrder },
          })
        )
      );

      return { success: true };
    }
  );
