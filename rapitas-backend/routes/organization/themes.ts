/**
 * Themes API Routes
 * Handles theme CRUD operations and default theme management
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { themeSchema } from "../../schemas/theme.schema";
import { NotFoundError, ValidationError } from "../../middleware/error-handler";

export const themesRoutes = new Elysia({ prefix: "/themes" })
  // Get all themes
  .get("/", async () => {
    return await prisma.theme.findMany({
      include: {
        _count: {
          select: { tasks: true },
        },
        category: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  })

  // Get default theme (must be before /:id to avoid route conflict)
  .get("/default/get", async () => {
    return await prisma.theme.findFirst({
      where: { isDefault: true },
      include: { category: true },
    });
  })

  // Get theme by ID
  .get(
    "/:id",
    async (context) => {
      const { params  } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError("無効なIDです");
      }

      const theme = await prisma.theme.findUnique({
        where: { id },
        include: {
          category: true,
          tasks: {
            where: { parentId: null },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!theme) {
        throw new NotFoundError("テーマが見つかりません");
      }

      return theme;
    }
  )

  // Create theme (categoryId is required)
  .post(
    "/",
    async (context) => {
      const { body  } = context;
      const { name,
        description,
        color,
        icon,
        isDevelopment,
        repositoryUrl,
        workingDirectory,
        defaultBranch,
        categoryId,
       } = body as {
        name: string; description?: string; color?: string; icon?: string;
        isDevelopment?: boolean; repositoryUrl?: string; workingDirectory?: string;
        defaultBranch?: string; categoryId: number;
      };

      return await prisma.theme.create({
        data: {
          name,
          categoryId,
          ...(description && { description }),
          ...(color && { color }),
          ...(icon && { icon }),
          ...(isDevelopment !== undefined && { isDevelopment }),
          ...(repositoryUrl && { repositoryUrl }),
          ...(workingDirectory && { workingDirectory }),
          ...(defaultBranch && { defaultBranch }),
        },
        include: { category: true },
      });
    },
    {
      body: themeSchema.create,
    }
  )

  // Update theme
  .patch(
    "/:id",
    async (context) => {
      const { params, body  } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError("無効なIDです");
      }

      // Check if theme exists
      const existingTheme = await prisma.theme.findUnique({
        where: { id },
      });

      if (!existingTheme) {
        throw new NotFoundError("テーマが見つかりません");
      }

      const { name,
        description,
        color,
        icon,
        isDevelopment,
        repositoryUrl,
        workingDirectory,
        defaultBranch,
        categoryId,
       } = body as {
        name?: string; description?: string; color?: string; icon?: string;
        isDevelopment?: boolean; repositoryUrl?: string; workingDirectory?: string;
        defaultBranch?: string; categoryId?: number | null; sortOrder?: number;
      };

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (color !== undefined) updateData.color = color;
      if (icon !== undefined) updateData.icon = icon;
      if (isDevelopment !== undefined) updateData.isDevelopment = isDevelopment;
      if (repositoryUrl !== undefined) updateData.repositoryUrl = repositoryUrl;
      if (workingDirectory !== undefined) updateData.workingDirectory = workingDirectory;
      if (defaultBranch !== undefined) updateData.defaultBranch = defaultBranch;
      if (categoryId !== undefined) updateData.categoryId = categoryId;

      // Auto-link to 開発 category when isDevelopment is being set to true and no categoryId specified
      if (isDevelopment === true && categoryId === undefined && !existingTheme.categoryId) {
        const devCategory = await prisma.category.findFirst({
          where: { name: "開発", isDefault: true },
        });
        if (devCategory) {
          updateData.categoryId = devCategory.id;
        }
      }

      return await prisma.theme.update({
        where: { id },
        data: updateData,
        include: { category: true },
      });
    },
    {
      body: themeSchema.update,
    }
  )

  // Delete theme
  .delete("/:id", async (context) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.theme.delete({
      where: { id },
    });
  })

  // Reorder themes
  .patch(
    "/reorder",
    async (context) => {
      const { body } = context;
      const { orders } = body as { orders: Array<{ id: number; sortOrder: number }> };

      await Promise.all(
        orders.map(({ id, sortOrder }) =>
          prisma.theme.update({
            where: { id },
            data: { sortOrder },
          })
        )
      );

      return { success: true };
    }
  )

  // Set default theme (per category: only one default per category)
  .patch("/:id/set-default", async (context) => {
      const { params  } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    // Get the theme to find its category
    const theme = await prisma.theme.findUnique({
      where: { id },
    });

    if (!theme) {
      throw new NotFoundError("テーマが見つかりません");
    }

    // Reset isDefault for themes in the same category only
    if (theme.categoryId) {
      await prisma.theme.updateMany({
        where: { categoryId: theme.categoryId, isDefault: true },
        data: { isDefault: false },
      });
    } else {
      // If no category, reset all themes without a category
      await prisma.theme.updateMany({
        where: { categoryId: null, isDefault: true },
        data: { isDefault: false },
      });
    }

    // Set the specified theme as default
    return await prisma.theme.update({
      where: { id },
      data: { isDefault: true },
      include: { category: true },
    });
  });
