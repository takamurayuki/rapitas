/**
 * Themes API Routes
 * Handles theme CRUD operations and default theme management
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { themeSchema } from "../schemas/theme.schema";
import { NotFoundError, ValidationError } from "../middleware/error-handler";

export const themesRoutes = new Elysia({ prefix: "/themes" })
  // Get all themes
  .get("/", async () => {
    return await prisma.theme.findMany({
      include: {
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  // Get default theme (must be before /:id to avoid route conflict)
  .get("/default/get", async () => {
    return await prisma.theme.findFirst({
      where: { isDefault: true },
    });
  })

  // Get theme by ID
  .get(
    "/:id",
    async ({ params }: { params: { id: string } }) => {
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError("無効なIDです");
      }

      const theme = await prisma.theme.findUnique({
        where: { id },
        include: {
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

  // Create theme
  .post(
    "/",
    async ({ body }: { body: {
      name: string;
      description?: string;
      color?: string;
      icon?: string;
      isDevelopment?: boolean;
      repositoryUrl?: string;
      workingDirectory?: string;
      defaultBranch?: string;
    }}) => {
      const {
        name,
        description,
        color,
        icon,
        isDevelopment,
        repositoryUrl,
        workingDirectory,
        defaultBranch,
      } = body;

      return await prisma.theme.create({
        data: {
          name,
          ...(description && { description }),
          ...(color && { color }),
          ...(icon && { icon }),
          ...(isDevelopment !== undefined && { isDevelopment }),
          ...(repositoryUrl && { repositoryUrl }),
          ...(workingDirectory && { workingDirectory }),
          ...(defaultBranch && { defaultBranch }),
        },
      });
    },
    {
      body: themeSchema.create,
    }
  )

  // Update theme
  .patch(
    "/:id",
    async ({ params, body }: {
      params: { id: string };
      body: {
        name?: string;
        description?: string;
        color?: string;
        icon?: string;
        isDevelopment?: boolean;
        repositoryUrl?: string;
        workingDirectory?: string;
        defaultBranch?: string;
      }
    }) => {
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

      const {
        name,
        description,
        color,
        icon,
        isDevelopment,
        repositoryUrl,
        workingDirectory,
        defaultBranch,
      } = body;

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (color !== undefined) updateData.color = color;
      if (icon !== undefined) updateData.icon = icon;
      if (isDevelopment !== undefined) updateData.isDevelopment = isDevelopment;
      if (repositoryUrl !== undefined) updateData.repositoryUrl = repositoryUrl;
      if (workingDirectory !== undefined) updateData.workingDirectory = workingDirectory;
      if (defaultBranch !== undefined) updateData.defaultBranch = defaultBranch;

      return await prisma.theme.update({
        where: { id },
        data: updateData,
      });
    },
    {
      body: themeSchema.update,
    }
  )

  // Delete theme
  .delete("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    return await prisma.theme.delete({
      where: { id },
    });
  })

  // Set default theme
  .patch("/:id/set-default", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError("無効なIDです");
    }

    // Reset all themes' isDefault to false
    await prisma.theme.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });

    // Set the specified theme as default
    return await prisma.theme.update({
      where: { id },
      data: { isDefault: true },
    });
  });
